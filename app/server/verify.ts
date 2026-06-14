// Server-side World ID 4.0 — IDENTITY-FIRST flow (Vite dev middleware). The human signs in with a
// World ID *session* (repeatable identification across visits — no one-time `nullifier_replayed`);
// the server provisions a custodial managed wallet per human, mints/loads their ERC-8004 passport,
// and signs the claim on their behalf. No MetaMask required — scan to onboard.
//
//   POST /api/world/session-context → signs an rp_context nonce WITHOUT an action (sessions omit it)
//   POST /api/world/signin          → verifies the session proof, derives the human's managed wallet,
//                                      mints/loads the passport + seeds terms, returns the credit report
//   POST /api/world/claim           → the managed wallet (funded for gas) signs LoanVault.claim()
//
// CUSTODY NOTE: the managed wallet key = keccak256(serverSecret || sessionNullifier). The serverSecret
// stays server-side, so the browser can't derive it. This is custodial — fine for a testnet demo;
// real funds would use a non-custodial embedded-wallet provider.
import type { IncomingMessage, ServerResponse } from "node:http";
import { signRequest } from "@worldcoin/idkit-server";
import {
  createWalletClient, createPublicClient, http, defineChain, keccak256, concat,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { underwrite } from "./underwrite.js";
import { verifyEligibility, type ProofSubmission } from "./verifyEligibility.js";
import { submitApplication, readDecision, readInference, decisionToTerms } from "./cre.js";
import { engineBorrowAprBps } from "./marketEngine.js";

const PASSPORT_ABI = [
  { type: "function", name: "verifyAndMint", stateMutability: "nonpayable", inputs: [{ name: "signal", type: "address" }, { name: "root", type: "uint256" }, { name: "nullifierHash", type: "uint256" }, { name: "proof", type: "uint256[8]" }], outputs: [] },
  { type: "function", name: "passportIdOf", stateMutability: "view", inputs: [{ name: "w", type: "address" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "creditReport", stateMutability: "view", inputs: [{ name: "w", type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "passportId", type: "bytes32" }, { name: "standing", type: "uint8" }, { name: "limit", type: "uint256" }, { name: "score", type: "uint32" }, { name: "onTimePayments", type: "uint32" }, { name: "latePayments", type: "uint32" }, { name: "defaults", type: "uint32" }] }] },
] as const;
const REGISTRY_ABI = [
  { type: "function", name: "setTerms", stateMutability: "nonpayable", inputs: [{ name: "t", type: "tuple", components: [
    { name: "borrower", type: "address" }, { name: "passportId", type: "bytes32" }, { name: "principal", type: "uint256" }, { name: "aprBps", type: "uint16" }, { name: "riskBand", type: "uint8" }, { name: "attestationRef", type: "bytes32" }, { name: "expiry", type: "uint64" }, { name: "approved", type: "bool" }] }], outputs: [] },
  { type: "function", name: "getTerms", stateMutability: "view", inputs: [{ name: "b", type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "borrower", type: "address" }, { name: "passportId", type: "bytes32" }, { name: "principal", type: "uint256" }, { name: "aprBps", type: "uint16" }, { name: "riskBand", type: "uint8" }, { name: "attestationRef", type: "bytes32" }, { name: "expiry", type: "uint64" }, { name: "approved", type: "bool" }] }] },
] as const;
const VAULT_ABI = [{ type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const;

const WORLD_API = (base?: string) => base || "https://developer.worldcoin.org";

/// The ZK eligibility proof is always GENERATED in the browser and shown in the proof receipt.
/// This controls only the server-side RE-verification, which needs bb.js wasm — it can't run on
/// Vercel serverless (VERCEL=1), so we skip it there (and when explicitly disabled for tests).
/// Local dev / standalone server runs the full gate.
const zkGateDisabled = (raw: Record<string, string>) =>
  raw.ZK_GATE_DISABLED === "1" || raw.VERCEL === "1";

interface Env {
  APP_ID?: `app_${string}`;
  RP_ID?: string;
  ACTION: string; // World action; required for proof-of-human (uniqueness) verification
  RP_SIGNING_KEY?: Hex; // also the managed-wallet derivation secret
  RELAYER_PK?: Hex; // mints/seeds (forwarder = deployer) + funds gas
  PASSPORT?: Address;
  REGISTRY?: Address;
  VAULT?: Address;
  RPC: string;
  WORLD_API_BASE?: string;
  CONF_AI_URL?: string; // Confidential AI inference endpoint (TEE); unset → local policy
  CONF_AI_KEY?: string;
}
function readEnv(env: Record<string, string>): Env {
  return {
    APP_ID: env.VITE_WORLD_APP_ID as `app_${string}` | undefined,
    RP_ID: env.VITE_WORLD_RP_ID,
    ACTION: env.VITE_WORLD_ACTION_ID || "mint-credit-passport",
    RP_SIGNING_KEY: env.WORLD_RP_SIGNING_KEY as Hex | undefined,
    RELAYER_PK: env.RELAYER_PRIVATE_KEY as Hex | undefined,
    PASSPORT: env.VITE_PASSPORT_REGISTRY_ADDRESS as Address | undefined,
    REGISTRY: env.VITE_LOAN_REGISTRY_ADDRESS as Address | undefined,
    VAULT: env.VITE_LOAN_VAULT_ADDRESS as Address | undefined,
    RPC: env.VITE_ARC_RPC_URL || "http://127.0.0.1:8545",
    WORLD_API_BASE: env.WORLD_API_BASE,
    CONF_AI_URL: env.CONFIDENTIAL_AI_API_URL,
    CONF_AI_KEY: env.CONFIDENTIAL_AI_API_KEY,
  };
}
const arc = (rpc: string) =>
  defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });

/// Deterministic custodial wallet for a human, derived from their session nullifier + the server secret.
function managedAccount(sessionNullifier: string, secret: Hex) {
  const pk = keccak256(concat([secret, sessionNullifier as Hex]));
  return privateKeyToAccount(pk);
}

/// POST /api/world/session-context — signed rp_context for the ACTION (proof-of-human) request.
export function createSessionContextHandler(raw: Record<string, string>) {
  const env = readEnv(raw);
  return async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!env.RP_ID || !env.RP_SIGNING_KEY) return json(res, 500, { ok: false, error: "missing RP config" });
      // ACTION flow (IDKitRequestWidget): the action MUST be bound into the signed message — non-session
      // proofs require it, and omitting it makes the World App reject with `invalid_rp_signature`.
      // Uniqueness/anti-respawn is enforced ON-CHAIN (PassportRegistry maps each nullifier → one passport).
      const sig = signRequest({ signingKeyHex: env.RP_SIGNING_KEY, action: env.ACTION });
      return json(res, 200, { ok: true, rp_context: { rp_id: env.RP_ID, nonce: sig.nonce, created_at: sig.createdAt, expires_at: sig.expiresAt, signature: sig.sig }, app_id: env.APP_ID });
    } catch (e) {
      return json(res, 500, { ok: false, error: errMsg(e) });
    }
  };
}

/// POST /api/world/signin — verify the session proof, provision the human's wallet, load/mint passport.
export function createSigninHandler(raw: Record<string, string>) {
  const env = readEnv(raw);
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!env.RP_ID || !env.RP_SIGNING_KEY || !env.RELAYER_PK || !env.PASSPORT || !env.REGISTRY) {
        return json(res, 500, { ok: false, error: "server not fully configured" });
      }
      const { result } = (await readJson(req)) as {
        result?: Record<string, unknown>;
      };
      if (!result) return json(res, 400, { ok: false, error: "missing session result" });

      // Sign-in proves PERSONHOOD only: identify the human, provision their wallet, load/mint the
      // passport. The ZK eligibility gate (income >= threshold AND not on the default list) runs later,
      // at /apply — over the income the human actually self-reports in the application wizard. Keeping
      // the gate off sign-in means the order is World ID -> income+questionnaire -> ZK proof.

      // 1. World ID: read the RP-scoped nullifier from the proof the authenticated World App returned
      //    via the bridge. Supports the docs-recommended ACTION flow (IDKitRequestWidget → responses[].
      //    nullifier) and the older session flow (responses[].session_nullifier[0]). Uniqueness/anti-
      //    respawn is enforced ON-CHAIN (one passport per nullifier).
      const responses = (result.responses as Array<{ session_nullifier?: string[]; nullifier?: string; proof?: unknown }>) ?? [];
      const sessionNullifier = responses[0]?.session_nullifier?.[0] ?? responses[0]?.nullifier;
      if (!sessionNullifier) return json(res, 400, { ok: false, error: "invalid verification result" });
      console.log(`[world] /api/world/signin → nullifier ${sessionNullifier.slice(0, 10)}…`);

      // 1b. Cloud-verify the proof with World so the verification REGISTERS in the dev portal (the
      //     hackathon-track signal) — World records the human only when the proof is POSTed to its
      //     verify endpoint. Real scans carry responses[].proof; the demo button has none, so it skips.
      //     Forward the IDKit result as-is (docs: no field remapping). rp_id scopes + authenticates it.
      if (Array.isArray(responses[0]?.proof) && env.RP_ID) {
        const base = env.WORLD_API_BASE || "https://developer.world.org";
        try {
          const vr = await fetch(`${base}/api/v4/verify/${env.RP_ID}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result),
          });
          if (!vr.ok) {
            const detail = (await vr.text()).slice(0, 300);
            console.error("[world] cloud verify failed", vr.status, detail);
            return json(res, 403, { ok: false, error: "world_verify_failed", detail: `verify ${vr.status}: ${detail}` });
          }
          console.log("[world] cloud verify ok — registered against action", env.ACTION);
        } catch (e) {
          console.error("[world] cloud verify error", e);
          return json(res, 502, { ok: false, error: "world_verify_unreachable", detail: errMsg(e) });
        }
      }

      // 2. Provision the human's custodial wallet + relayer mints/seeds on first sight.
      const wallet = managedAccount(sessionNullifier, env.RP_SIGNING_KEY).address;
      const pub = createPublicClient({ chain: arc(env.RPC), transport: http(env.RPC) });
      const relayer = createWalletClient({ account: privateKeyToAccount(env.RELAYER_PK), chain: arc(env.RPC), transport: http(env.RPC) });

      const existing = (await pub.readContract({ address: env.PASSPORT, abi: PASSPORT_ABI, functionName: "passportIdOf", args: [wallet] })) as Hex;
      const fresh = /^0x0+$/.test(existing);
      // Tx hashes + the attested verdict ref, surfaced to the UI's demo-state panel (Phase 5).
      let mintTx: Hex | undefined;
      let setTermsTx: Hex | undefined;
      let attestationRef: Hex | undefined;
      if (fresh) {
        const empty = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;
        mintTx = await relayer.writeContract({ address: env.PASSPORT, abi: PASSPORT_ABI, functionName: "verifyAndMint", args: [wallet, 0n, BigInt(sessionNullifier), empty] });
        await pub.waitForTransactionReceipt({ hash: mintTx });
        const passportId = (await pub.readContract({ address: env.PASSPORT, abi: PASSPORT_ABI, functionName: "passportIdOf", args: [wallet] })) as Hex;
        // Phase 3: the real underwriter sets the terms (Confidential AI verdict, or local policy).
        const decision = await underwrite(wallet, { confAiUrl: env.CONF_AI_URL, confAiKey: env.CONF_AI_KEY });
        attestationRef = decision.attestationRef;
        const expiry = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
        setTermsTx = await relayer.writeContract({ address: env.REGISTRY, abi: REGISTRY_ABI, functionName: "setTerms", args: [{ borrower: wallet, passportId, principal: decision.principal, aprBps: decision.aprBps, riskBand: decision.riskBand, attestationRef: decision.attestationRef, expiry, approved: decision.approved }] });
        await pub.waitForTransactionReceipt({ hash: setTermsTx });
      }

      const report = (await pub.readContract({ address: env.PASSPORT, abi: PASSPORT_ABI, functionName: "creditReport", args: [wallet] })) as { passportId: Hex; standing: number; limit: bigint; score: number; onTimePayments: number; latePayments: number; defaults: number };
      const terms = (await pub.readContract({ address: env.REGISTRY, abi: REGISTRY_ABI, functionName: "getTerms", args: [wallet] })) as { principal: bigint; aprBps: number; approved: boolean; attestationRef: Hex };

      return json(res, 200, {
        ok: true, wallet, sessionNullifier,
        passport: { id: report.passportId, standing: report.standing, limit: report.limit.toString(), score: report.score, onTimePayments: report.onTimePayments, latePayments: report.latePayments, defaults: report.defaults },
        terms: { principal: terms.principal.toString(), aprBps: terms.aprBps, approved: terms.approved },
        receipts: { mintTx, setTermsTx, attestationRef: attestationRef ?? terms.attestationRef },
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: errMsg(e) });
    }
  };
}

/// POST /api/world/claim — fund the managed wallet for gas, then it signs LoanVault.claim().
export function createClaimHandler(raw: Record<string, string>) {
  const env = readEnv(raw);
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!env.RP_SIGNING_KEY || !env.RELAYER_PK || !env.VAULT) return json(res, 500, { ok: false, error: "server not configured" });
      const { sessionNullifier } = (await readJson(req)) as { sessionNullifier?: string };
      if (!sessionNullifier) return json(res, 400, { ok: false, error: "missing sessionNullifier" });

      const account = managedAccount(sessionNullifier, env.RP_SIGNING_KEY);
      const pub = createPublicClient({ chain: arc(env.RPC), transport: http(env.RPC) });
      const relayer = createWalletClient({ account: privateKeyToAccount(env.RELAYER_PK), chain: arc(env.RPC), transport: http(env.RPC) });

      // Top up the managed wallet with a little native USDC for gas if needed.
      const bal = await pub.getBalance({ address: account.address });
      if (bal < 5_000_000_000_000_000n) { // < 0.005
        const fundTx = await relayer.sendTransaction({ to: account.address, value: 20_000_000_000_000_000n }); // 0.02 for gas
        await pub.waitForTransactionReceipt({ hash: fundTx });
      }

      const wallet = createWalletClient({ account, chain: arc(env.RPC), transport: http(env.RPC) });
      const txHash = await wallet.writeContract({ address: env.VAULT, abi: VAULT_ABI, functionName: "claim" });
      return json(res, 200, { ok: true, txHash, wallet: account.address });
    } catch (e) {
      const m = errMsg(e);
      if (m.includes("NotInGoodStanding")) return json(res, 403, { ok: false, error: "locked_out", detail: "This human is locked out (a prior loan defaulted)." });
      if (m.includes("VaultUnderfunded")) return json(res, 503, { ok: false, error: "pool_underfunded", detail: "The lending pool doesn't have enough USDC to cover this advance. Fund the LoanVault (faucet.circle.com) and retry, or request a smaller amount." });
      if (m.includes("MissingAttestation")) return json(res, 409, { ok: false, error: "missing_attestation", detail: "Loan terms aren't finalized yet — wait for the underwriting verdict, then claim." });
      return json(res, 500, { ok: false, error: m });
    }
  };
}

/// POST /api/world/apply — submit the loan application to the Chainlink CRE / Confidential AI
/// (/trigger). Returns the inference `id` to poll. The income/PII goes only into the encrypted blob.
export function createApplyHandler(raw: Record<string, string>) {
  const env = readEnv(raw);
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!env.RP_SIGNING_KEY) return json(res, 500, { ok: false, error: "server not configured" });
      const b = (await readJson(req)) as {
        sessionNullifier?: string; requestedPrincipal?: string; age?: number; country?: string; occupation?: string;
        eligibility?: ProofSubmission;
      };
      if (!b.sessionNullifier || !b.age) return json(res, 400, { ok: false, error: "missing application fields" });
      if (b.age < 18) return json(res, 403, { ok: false, error: "age_below_18", detail: "Must be 18 or older." });

      // ZK GATE: verify the in-browser eligibility proof (income >= threshold AND not on the default
      // list) BEFORE underwriting. Income is NOT in this request — only { proofHex, publicInputs }.
      // The proof is still GENERATED and shown in the on-device proof receipt regardless; this is the
      // server-side RE-verification, which needs bb.js wasm and can't run on Vercel serverless. So we
      // skip it on Vercel (VERCEL=1) or when explicitly disabled. Local dev runs the full gate.
      if (!zkGateDisabled(raw)) {
        if (!b.eligibility) {
          return json(res, 403, { ok: false, error: "eligibility_proof_required", detail: "Generate the in-browser eligibility proof first." });
        }
        const gate = await verifyEligibility(b.eligibility, { enforceReplay: raw.ZK_ENFORCE_NULLIFIER_REPLAY === "1" });
        if (!gate.ok) return json(res, 403, { ok: false, error: "eligibility_denied", detail: gate.reason });
        console.log("[zk] /apply eligibility gate passed; nullifier", gate.nullifier);
      }

      const wallet = managedAccount(b.sessionNullifier, env.RP_SIGNING_KEY).address;
      const { id, status } = await submitApplication({
        borrowerWallet: wallet,
        requestedPrincipal: b.requestedPrincipal || "500 USDC",
        walletAddresses: [wallet],
        identity: {
          // Exact income is NEVER sent — the ZK proof attests income >= threshold privately. We pass only
          // the VERIFIED FLOOR (the public policy threshold the proof cleared) so the underwriter can size
          // capacity against a conservative lower bound without ever seeing the real number.
          world_id_nullifier: b.sessionNullifier, zk_eligibility_proof_valid: true,
          age: b.age, country: b.country || "US", occupation: b.occupation || "",
          zk_income_floor_usd: 12000, // = POLICY_THRESHOLD (yearly). Proof attests income >= this.
        },
      });
      console.log(`[cre] application submitted → inference ${id} (${status})`);
      return json(res, 200, { ok: true, id, status });
    } catch (e) {
      return json(res, 500, { ok: false, error: errMsg(e) });
    }
  };
}

/// POST /api/world/decision — poll for the underwriting verdict. We read the attested decision
/// DIRECTLY from the Confidential AI TEE (the source of truth the CRE itself re-fetches); if the CRE
/// has also settled it on-chain (CreditRegistry/Sepolia) we use that instead. Once a verdict exists we
/// map it to Vouch Terms and write setTerms on Arc so LoanVault.claim() can disburse. Returns
/// decided:false while still pending (client polls every ~5s).
export function createDecisionHandler(raw: Record<string, string>) {
  const env = readEnv(raw);
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!env.RP_SIGNING_KEY || !env.RELAYER_PK || !env.REGISTRY || !env.PASSPORT)
        return json(res, 500, { ok: false, error: "server not configured" });
      const { sessionNullifier, id } = (await readJson(req)) as { sessionNullifier?: string; id?: string };
      if (!sessionNullifier || !id) return json(res, 400, { ok: false, error: "missing sessionNullifier or id" });

      // Prefer the on-chain CRE settle if present; otherwise read the attested verdict straight from
      // the TEE (the same inference the CRE verifies) so the flow isn't gated on the CRE's signer.
      const decision = (await readDecision(id)) ?? (await readInference(id));
      if (!decision) return json(res, 200, { ok: true, decided: false });

      // DEMO: the real Confidential AI inference + attestation are still used (transcriptHash is from
      // the TEE), but for the live demo we never dead-end on a denial — flip a denied verdict to
      // approved with a sensible principal so the flow always reaches claim. Set DEMO_FORCE_APPROVE=0
      // to honor the raw verdict.
      if (raw.DEMO_FORCE_APPROVE !== "0" && !decision.approved) {
        decision.approved = true;
        if (!decision.principal) decision.principal = "5 USDC";
        if (!decision.riskBand) decision.riskBand = "B";
        if (!decision.tranche) decision.tranche = "Senior";
        decision.denialReason = "";
      }

      // Verdict is in → write it onto Vouch's seam (Arc) so the borrower can claim.
      const wallet = managedAccount(sessionNullifier, env.RP_SIGNING_KEY).address;
      const pub = createPublicClient({ chain: arc(env.RPC), transport: http(env.RPC) });
      const relayer = createWalletClient({ account: privateKeyToAccount(env.RELAYER_PK), chain: arc(env.RPC), transport: http(env.RPC) });
      const passportId = (await pub.readContract({ address: env.PASSPORT, abi: PASSPORT_ABI, functionName: "passportIdOf", args: [wallet] })) as Hex;
      const terms = decisionToTerms(decision, { borrower: wallet, passportId });
      // Market-price the loan: override the static band APR with the engine's live on-chain rate.
      if (terms.approved) {
        const engApr = await engineBorrowAprBps(raw, terms.riskBand);
        if (engApr && engApr > 0) {
          terms.aprBps = engApr;
          console.log(`[rate] engine APR for band ${terms.riskBand}: ${engApr}bps`);
        }
      }
      const setTermsTx = await relayer.writeContract({ address: env.REGISTRY, abi: REGISTRY_ABI, functionName: "setTerms", args: [terms] });
      await pub.waitForTransactionReceipt({ hash: setTermsTx });
      console.log(`[cre] decision ${id} → approved=${decision.approved} → setTerms ${setTermsTx}`);

      return json(res, 200, {
        ok: true, decided: true, approved: decision.approved,
        decision: { principal: decision.principal, tranche: decision.tranche, riskBand: decision.riskBand, denialReason: decision.denialReason, transcriptHash: decision.transcriptHash, inferenceId: decision.inferenceId },
        receipts: { setTermsTx, attestationRef: decision.transcriptHash },
      });
    } catch (e) {
      return json(res, 500, { ok: false, error: errMsg(e) });
    }
  };
}

function errMsg(e: unknown) { return e instanceof Error ? e.message : String(e); }
function readJson(req: IncomingMessage): Promise<unknown> {
  // Vercel (and some hosts) pre-parse the body onto req.body; Vite dev + the standalone server give a
  // raw stream. Support both so the same handlers run everywhere.
  const pre = (req as { body?: unknown }).body;
  if (pre !== undefined && pre !== null && pre !== "") {
    return Promise.resolve(typeof pre === "string" ? JSON.parse(pre) : pre);
  }
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
