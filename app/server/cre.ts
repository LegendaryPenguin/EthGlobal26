// Chainlink CRE / Confidential AI underwriting client (server-side). The real async flow:
//   1. submitApplication() → POST /trigger (Confidential AI)            → returns an inference `id`.
//   2. readDecision(id)    → poll CreditRegistry (on ETH SEPOLIA) until exists → the verdict.
// The verdict is then mapped to Vouch's LoanRegistry.Terms (decisionToTerms) and written on ARC via
// the relayer, so LoanVault.claim() works unchanged.
//
// PRIVACY (Golden Rule #2): income/PII lives only inside the base64 encrypted_identity_blob sent to
// the TEE; never logged here, never written on-chain — only the attested verdict is.
import { createPublicClient, http, defineChain, parseUnits, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";

const TRIGGER_BASE = process.env.CRE_TRIGGER_URL || "https://judge-recount-blizzard.ngrok-free.dev";
// CreditRegistry is deployed on ETHEREUM SEPOLIA (not Arc) — the CRE writes decisions there.
const CREDIT_REGISTRY = (process.env.CREDIT_REGISTRY_ADDRESS as Address | undefined) ||
  "0x6Bd85f012fA8d1e66B1f8d7fc5844A5b7B628186";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

export type Identity = {
  world_id_nullifier: string;
  zk_eligibility_proof_valid: boolean; // must be true; income amount never leaves the device
  age: number; // must be >= 18
  country: string;
  occupation: string;
  self_reported_yearly_income_usd: number; // primary risk-banding variable
};

export type Decision = {
  borrower: Address;
  approved: boolean;
  principal: string; // e.g. "500 USDC" ("" if denied)
  tranche: string; // "Senior" | "Junior"
  riskBand: string; // "A".."D"
  denialReason: string;
  transcriptHash: Hex; // attestation digest
  inferenceId: string;
  timestamp: bigint;
  exists: boolean;
};

const REGISTRY_ABI = [
  {
    type: "function", name: "getDecisionByInferenceId", stateMutability: "view",
    inputs: [{ name: "inferenceId", type: "string" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "borrower", type: "address" }, { name: "approved", type: "bool" },
      { name: "principal", type: "string" }, { name: "tranche", type: "string" },
      { name: "riskBand", type: "string" }, { name: "denialReason", type: "string" },
      { name: "transcriptHash", type: "bytes32" }, { name: "inferenceId", type: "string" },
      { name: "timestamp", type: "uint256" }, { name: "exists", type: "bool" },
    ] }],
  },
] as const;

/// 1. Submit the application to the Confidential AI trigger. Returns the inference id to poll.
export async function submitApplication(opts: {
  borrowerWallet: Address;
  requestedPrincipal: string; // "5000 USDC"
  walletAddresses: Address[];
  identity: Identity;
}): Promise<{ id: string; status: string }> {
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

const sepoliaChain = { ...sepolia, rpcUrls: { default: { http: [SEPOLIA_RPC] } } } as typeof sepolia;

/// 2. Read the on-chain decision for an inference id from CreditRegistry (Sepolia). null until exists.
export async function readDecision(id: string): Promise<Decision | null> {
  const pub = createPublicClient({ chain: sepoliaChain, transport: http(SEPOLIA_RPC) });
  try {
    const d = (await pub.readContract({
      address: CREDIT_REGISTRY, abi: REGISTRY_ABI, functionName: "getDecisionByInferenceId", args: [id],
    })) as Decision;
    return d?.exists ? d : null;
  } catch {
    return null; // not yet written / id unknown
  }
}

/// Map the CRE verdict → Vouch LoanRegistry.Terms (band → APR; principal parsed to 6dp USDC).
const BAND_APR: Record<string, number> = { A: 800, B: 1200, C: 1800, D: 2600 };
export function decisionToTerms(d: Decision, ctx: { borrower: Address; passportId: Hex }) {
  const principalNum = d.principal.match(/[\d.]+/)?.[0] ?? "0";
  const band = (d.riskBand?.toUpperCase?.() ?? "C").slice(0, 1);
  const bandIdx = ["A", "B", "C", "D"].indexOf(band);
  return {
    borrower: ctx.borrower,
    passportId: ctx.passportId,
    principal: d.approved ? parseUnits(principalNum, 6) : 0n,
    aprBps: BAND_APR[band] ?? 1800,
    riskBand: bandIdx < 0 ? 2 : bandIdx,
    attestationRef: d.transcriptHash,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600),
    approved: d.approved,
  };
}
