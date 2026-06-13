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
import { underwrite } from "./underwrite";

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

interface Env {
  APP_ID?: `app_${string}`;
  RP_ID?: string;
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

/// POST /api/world/session-context — signed rp_context for a SESSION request (no action).
export function createSessionContextHandler(raw: Record<string, string>) {
  const env = readEnv(raw);
  return async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!env.RP_ID || !env.RP_SIGNING_KEY) return json(res, 500, { ok: false, error: "missing RP config" });
      const sig = signRequest({ signingKeyHex: env.RP_SIGNING_KEY }); // no action → session
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
      const { result } = (await readJson(req)) as { result?: Record<string, unknown> };
      if (!result) return json(res, 400, { ok: false, error: "missing session result" });

      // 1. Verify the session proof with World (real human + session).
      const vres = await fetch(`${WORLD_API(env.WORLD_API_BASE)}/api/v4/verify/${env.RP_ID}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result),
      });
      const vdata = (await vres.json()) as { success?: boolean; code?: string; detail?: string };
      console.log(`[world] /api/world/signin → verify HTTP ${vres.status}`, JSON.stringify(vdata));
      if (!vres.ok || !vdata.success) return json(res, 400, { ok: false, error: `World sign-in failed: ${vdata.code ?? vres.status}`, detail: vdata.detail });

      const responses = (result.responses as Array<{ session_nullifier?: string[] }>) ?? [];
      const sessionNullifier = responses[0]?.session_nullifier?.[0];
      if (!sessionNullifier) return json(res, 502, { ok: false, error: "no session_nullifier in proof" });

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
      return json(res, 500, { ok: false, error: m });
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
