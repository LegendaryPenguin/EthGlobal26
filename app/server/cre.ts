// Chainlink CRE / Confidential AI underwriting client (server-side). Replaces the local underwrite()
// stub with the real async flow:
//   1. submitApplication() → POST /trigger (Confidential AI) → returns an inference `id`.
//   2. readDecision(id)    → poll the on-chain CreditRegistry until exists, returns the verdict.
// The verdict is then mapped to Vouch's LoanRegistry.Terms (see decisionToTerms) and written via the
// relayer so the existing LoanVault.claim() works unchanged.
//
// PRIVACY (Golden Rule #2): the income/PII lives only inside the base64 encrypted_identity_blob sent
// to the TEE; it is never logged here and never written on-chain — only the attested verdict is.
import { createPublicClient, http, defineChain, parseUnits, type Address, type Hex } from "viem";

const TRIGGER_BASE = process.env.CRE_TRIGGER_URL || "https://judge-recount-blizzard.ngrok-free.dev";
const CREDIT_REGISTRY = process.env.CREDIT_REGISTRY_ADDRESS as Address | undefined; // CRE's consumer on Arc
const RPC = process.env.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network";

export type Identity = {
  world_id_nullifier: string;
  zk_eligibility_proof_valid: boolean; // must be true (Noir gate); income amount never leaves device
  age: number; // must be >= 18
  country: string;
  occupation: string;
  self_reported_yearly_income_usd: number; // primary risk-banding variable
};

export type Decision = {
  exists: boolean;
  approved: boolean;
  principal: string; // e.g. "500 USDC" ("" if denied)
  tranche: string; // "Senior" | "Junior"
  riskBand: string; // "A".."D"
  denialReason: string;
  transcriptHash: Hex; // attestation digest
};

const arc = defineChain({
  id: 5042002, name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

/// 1. Submit the application to the Confidential AI trigger. Returns the inference id to poll.
export async function submitApplication(opts: {
  borrowerWallet: Address;
  requestedPrincipal: string; // "5000 USDC"
  walletAddresses: Address[];
  identity: Identity;
}): Promise<{ id: string; status: string }> {
  // base64 the identity (matches the spec's btoa(unescape(encodeURIComponent(JSON))) → utf8 base64).
  const blob = Buffer.from(JSON.stringify(opts.identity), "utf8").toString("base64");
  const res = await fetch(`${TRIGGER_BASE}/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({
      input: {
        borrower_wallet: opts.borrowerWallet,
        requested_principal: opts.requestedPrincipal,
        wallet_addresses: opts.walletAddresses,
        encrypted_identity_blob: blob, // PII ONLY here — never logged
      },
    }),
  });
  const data = (await res.json()) as { id?: string; status?: string; error?: string };
  if (!data.id) throw new Error(`trigger failed: ${data.error ?? res.status}`);
  return { id: data.id, status: data.status ?? "queued" };
}

// CreditRegistry read ABI — CONFIRM against the deployed contract. Common shape: a getter keyed by the
// inference id returning the Decision struct. The UUID `id` is likely keccak256'd or stored as a
// string key on-chain; adjust `idKey` + the function name/signature once you share the ABI.
const CREDIT_REGISTRY_ABI = [
  {
    type: "function", name: "getDecision", stateMutability: "view",
    inputs: [{ name: "id", type: "string" }],
    outputs: [{ type: "tuple", components: [
      { name: "exists", type: "bool" }, { name: "approved", type: "bool" },
      { name: "principal", type: "string" }, { name: "tranche", type: "string" },
      { name: "riskBand", type: "string" }, { name: "denialReason", type: "string" },
      { name: "transcriptHash", type: "bytes32" },
    ] }],
  },
] as const;

/// 2. Read the on-chain decision for an inference id. Returns null until it exists.
/// NEEDS: CREDIT_REGISTRY_ADDRESS env + the confirmed read function/key mapping (see ABI note).
export async function readDecision(id: string): Promise<Decision | null> {
  if (!CREDIT_REGISTRY) throw new Error("CREDIT_REGISTRY_ADDRESS not set");
  const pub = createPublicClient({ chain: arc, transport: http(RPC) });
  try {
    const d = (await pub.readContract({
      address: CREDIT_REGISTRY, abi: CREDIT_REGISTRY_ABI, functionName: "getDecision", args: [id],
    })) as Decision;
    return d.exists ? d : null;
  } catch {
    return null; // not yet written / id not found
  }
}

/// Map the CRE verdict → Vouch LoanRegistry.Terms (band → APR; principal parsed to 6dp USDC).
const BAND_APR: Record<string, number> = { A: 800, B: 1200, C: 1800, D: 2600 };
export function decisionToTerms(d: Decision, ctx: { borrower: Address; passportId: Hex }) {
  const principalNum = d.principal.match(/[\d.]+/)?.[0] ?? "0";
  const band = d.riskBand?.toUpperCase?.() ?? "C";
  return {
    borrower: ctx.borrower,
    passportId: ctx.passportId,
    principal: d.approved ? parseUnits(principalNum, 6) : 0n,
    aprBps: BAND_APR[band] ?? 1800,
    riskBand: ["A", "B", "C", "D"].indexOf(band) < 0 ? 2 : ["A", "B", "C", "D"].indexOf(band),
    attestationRef: d.transcriptHash,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600),
    approved: d.approved,
  };
}
