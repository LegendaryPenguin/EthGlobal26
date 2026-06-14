// Chainlink CRE / Confidential AI underwriting client (server-side). The real async flow:
//   1. submitApplication() → POST /trigger (Confidential AI)            → returns an inference `id`.
//   2. readDecision(id)    → poll CreditRegistry (on ETH SEPOLIA) until exists → the verdict.
// The verdict is then mapped to Vouch's LoanRegistry.Terms (decisionToTerms) and written on ARC via
// the relayer, so LoanVault.claim() works unchanged.
//
// PRIVACY (Golden Rule #2): income/PII lives only inside the base64 encrypted_identity_blob sent to
// the TEE; never logged here, never written on-chain — only the attested verdict is.
import { createPublicClient, http, defineChain, parseUnits, sha256, stringToHex, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { SYSTEM_PROMPT, buildClassificationPrompt, deriveIntegrityTag } from "./crePrompt.js";

// Read env LAZILY (at call time, not module load): on Vercel process.env is populated, but in the
// Vite dev server the config callback mirrors .env into process.env AFTER this module is first
// imported — so reading these at module top would always see empty values in dev.
function cfg() {
  const TRIGGER_BASE = process.env.CRE_TRIGGER_URL || "https://judge-recount-blizzard.ngrok-free.dev";
  return {
    TRIGGER_BASE,
    // Confidential AI (the TEE attester). We submit the inference DIRECTLY here when we hold the API
    // key, because the deployed CRE /trigger returns an empty async ack and never returns the id.
    CONF_AI_BASE: process.env.CONF_AI_BASE_URL || "https://confidential-ai-dev-preview.cldev.cloud",
    CONF_AI_MODEL: process.env.CONF_AI_MODEL || "gemma4",
    CONF_AI_API_KEY: process.env.CONF_AI_API_KEY || process.env.CRE_CONF_AI_API_KEY || "",
    WORKFLOW_HMAC_SECRET: process.env.WORKFLOW_HMAC_SECRET || process.env.CRE_WORKFLOW_HMAC_SECRET || "",
    // Where Confidential AI posts the completed inference: the live CRE /trigger, which verifies the
    // integrity tag and settles the verdict onto CreditRegistry (Sepolia). Must match the CRE config.
    CRE_CALLBACK_URL: process.env.CRE_CALLBACK_URL || `${TRIGGER_BASE}/trigger`,
    // CreditRegistry is deployed on ETHEREUM SEPOLIA (not Arc) — the CRE writes decisions there.
    CREDIT_REGISTRY: ((process.env.CREDIT_REGISTRY_ADDRESS as Address | undefined) ||
      "0x6Bd85f012fA8d1e66B1f8d7fc5844A5b7B628186") as Address,
    SEPOLIA_RPC: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
  };
}

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

/// 1. Submit the application for underwriting. Returns the inference id to poll.
///
/// Preferred path (when CONF_AI_API_KEY is set): submit the inference DIRECTLY to Confidential AI,
/// replicating the CRE workflow's exact prompt + integrity tag, with cre_callback pointed at the
/// live CRE /trigger. Confidential AI returns the inference id synchronously (202), and on
/// completion calls back the CRE, which verifies the integrity tag and settles the verdict onto
/// CreditRegistry. This bypasses the deployed /trigger, whose async ack never returns the id.
/// Fallback path (no API key): POST the CRE /trigger directly (legacy shape).
export async function submitApplication(opts: {
  borrowerWallet: Address;
  requestedPrincipal: string; // "5000 USDC"
  walletAddresses: Address[];
  identity: Identity;
}): Promise<{ id: string; status: string }> {
  const blob = Buffer.from(JSON.stringify(opts.identity), "utf8").toString("base64");

  const { CONF_AI_API_KEY, WORKFLOW_HMAC_SECRET } = cfg();
  if (CONF_AI_API_KEY && WORKFLOW_HMAC_SECRET) {
    return submitToConfidentialAI(opts, blob);
  }
  return submitToTrigger(opts, blob);
}

/// Direct Confidential AI submission — mirrors cre-workflow/modules/attest.ts:assessAndClassify.
async function submitToConfidentialAI(
  opts: { borrowerWallet: Address; requestedPrincipal: string; walletAddresses: Address[]; identity: Identity },
  blob: string,
): Promise<{ id: string; status: string }> {
  const { CONF_AI_BASE, CONF_AI_MODEL, CONF_AI_API_KEY, WORKFLOW_HMAC_SECRET, CRE_CALLBACK_URL } = cfg();
  // Settle re-derives this tag from the borrower in the prompt; it MUST bind the same wallet.
  const integrityTag = deriveIntegrityTag(WORKFLOW_HMAC_SECRET, opts.borrowerWallet);
  // Wallet profile is corroborating context only (never verified at settle); a thin profile is fine.
  const profile = { walletCount: opts.walletAddresses.length || 1, totalStablecoinBalanceUsdc: 0 };
  const body = JSON.stringify({
    model: CONF_AI_MODEL,
    system_prompt: SYSTEM_PROMPT,
    prompt: buildClassificationPrompt(profile, blob, opts.borrowerWallet, opts.requestedPrincipal, integrityTag),
    cre_callback: { url: CRE_CALLBACK_URL },
  });
  const res = await fetch(`${CONF_AI_BASE}/v1/inference`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CONF_AI_API_KEY}` },
    body,
  });
  const txt = await res.text();
  if (res.status >= 400) {
    throw new Error(`Confidential AI submit failed (HTTP ${res.status}): ${txt.slice(0, 160)}`);
  }
  let data: { id?: string; status?: string };
  try { data = JSON.parse(txt); } catch { throw new Error(`Confidential AI returned non-JSON (HTTP ${res.status}): ${txt.slice(0, 120)}`); }
  if (!data.id) throw new Error(`Confidential AI: no inference id (HTTP ${res.status})`);
  return { id: data.id, status: data.status ?? "queued" };
}

/// Legacy fallback — POST the CRE /trigger directly (used only when no Confidential AI key is set).
async function submitToTrigger(
  opts: { borrowerWallet: Address; requestedPrincipal: string; walletAddresses: Address[]; identity: Identity },
  blob: string,
): Promise<{ id: string; status: string }> {
  const { TRIGGER_BASE } = cfg();
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
  const txt = await res.text();
  if (!txt.trim()) {
    throw new Error(`CRE /trigger returned an empty body (HTTP ${res.status}); expected {id,status}. Set CONF_AI_API_KEY to submit inference directly instead.`);
  }
  let data: { id?: string; status?: string; error?: string };
  try {
    data = JSON.parse(txt);
  } catch {
    const bare = txt.trim().replace(/^"|"$/g, "");
    if (/^[0-9a-fA-F-]{8,}$/.test(bare)) return { id: bare, status: "queued" };
    throw new Error(`CRE /trigger returned non-JSON (HTTP ${res.status}): ${txt.slice(0, 120)}`);
  }
  if (!data.id) throw new Error(`CRE /trigger: no inference id (HTTP ${res.status})${data.error ? ` — ${data.error}` : ""}`);
  return { id: data.id, status: data.status ?? "queued" };
}

/// Read the verdict DIRECTLY from the Confidential AI TEE (GET /v1/inference/:id). This is the
/// attested source of truth: the same inference the CRE settle re-fetches and verifies. We read it
/// ourselves so the demo doesn't depend on the CRE's on-chain settle (which requires a funded CRE
/// signer we don't control). Returns null until the TEE reports the inference `completed`.
///
/// transcriptHash mirrors settle.ts: the enclave response_digest when present, else sha256(output).
export async function readInference(id: string): Promise<Decision | null> {
  const { CONF_AI_API_KEY, CONF_AI_BASE } = cfg();
  if (!CONF_AI_API_KEY) return null;
  let res: Response;
  try {
    res = await fetch(`${CONF_AI_BASE}/v1/inference/${id}`, { headers: { Authorization: `Bearer ${CONF_AI_API_KEY}` } });
  } catch { return null; }
  if (res.status >= 400) return null;
  const j = (await res.json()) as {
    status?: string; output?: string;
    resources?: { response_digest?: string }[];
  };
  if (j.status !== "completed" || !j.output) return null; // queued / running / failed

  // The model returns JSON, sometimes wrapped in a ```json fence — strip it like settle.ts does.
  const fenced = j.output.trim().match(/^```(?:[a-zA-Z0-9]+)?\s*([\s\S]*?)\s*```$/);
  const jsonStr = fenced ? fenced[1].trim() : j.output;
  let v: { approved?: boolean; principal?: string | null; tranche?: string | null; riskBand?: string | null; denialReason?: string | null };
  try { v = JSON.parse(jsonStr); } catch { return null; }

  const digest = j.resources?.[0]?.response_digest;
  const transcriptHash = (digest
    ? (`0x${digest.replace(/^0[xX]/, "").toLowerCase()}`)
    : sha256(stringToHex(j.output))) as Hex;

  return {
    borrower: "0x0000000000000000000000000000000000000000", // resolved from session by the caller
    approved: !!v.approved,
    principal: v.approved ? (v.principal ?? "") : "",
    tranche: v.tranche ?? "",
    riskBand: v.riskBand ?? "",
    denialReason: v.approved ? "" : (v.denialReason ?? ""),
    transcriptHash,
    inferenceId: id,
    timestamp: 0n,
    exists: true,
  };
}

/// 2. Read the on-chain decision for an inference id from CreditRegistry (Sepolia). null until exists.
export async function readDecision(id: string): Promise<Decision | null> {
  const { SEPOLIA_RPC, CREDIT_REGISTRY } = cfg();
  const sepoliaChain = { ...sepolia, rpcUrls: { default: { http: [SEPOLIA_RPC] } } } as typeof sepolia;
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
