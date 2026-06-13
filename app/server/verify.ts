// Server-side World ID 4.0 flow (Path A — cloud verify), wired as Vite middleware in vite.config.ts.
// DEV-ONLY: runs in Node alongside `npm run dev`; the RP signing key + relayer key never reach the
// browser bundle (no VITE_ prefix). Two endpoints:
//
//   POST /api/world/context  → signs a fresh rp_context (nonce + RP signature) with the RP signing
//                              key, so the browser's IDKit request is bound to a nonce World will
//                              accept. (World ID 4.0 requires this; idkit cannot fabricate it.)
//   POST /api/verify         → forwards the v4 proof to World's /api/v4/verify/{rp_id} (real ZK +
//                              nullifier check), then mints the ERC-8004 passport via a relayer.
//
// On Arc there is no in-contract World ID verifier (docs/05), so validation happens here — which the
// World ID track permits. The on-chain MockWorldID rubber-stamps the mint; the passport is keyed by
// the REAL RP-scoped nullifier so anti-respawn still binds to the verified human.
import type { IncomingMessage, ServerResponse } from "node:http";
import { signRequest } from "@worldcoin/idkit-server";
import { createWalletClient, http, defineChain, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { passportRegistryAbi } from "../src/abis/passportRegistry";

// World's cloud verify host (same origin idkit used historically). Override with WORLD_API_BASE.
const WORLD_API = (envBase?: string) => envBase || "https://developer.worldcoin.org";

interface Env {
  APP_ID?: `app_${string}`;
  ACTION: string;
  RP_ID?: string;
  RP_SIGNING_KEY?: string; // the RP's registered signer key (signs the nonce)
  RELAYER_PK?: Hex; // mints the passport on-chain (local devnet: anvil #0)
  PASSPORT?: Address;
  RPC: string;
  WORLD_API_BASE?: string;
}

function readEnv(env: Record<string, string>): Env {
  return {
    APP_ID: env.VITE_WORLD_APP_ID as `app_${string}` | undefined,
    ACTION: env.VITE_WORLD_ACTION_ID || "mint-credit-passport",
    RP_ID: env.VITE_WORLD_RP_ID,
    RP_SIGNING_KEY: env.WORLD_RP_SIGNING_KEY,
    RELAYER_PK: env.RELAYER_PRIVATE_KEY as Hex | undefined,
    PASSPORT: env.VITE_PASSPORT_REGISTRY_ADDRESS as Address | undefined,
    RPC: env.VITE_ARC_RPC_URL || "http://127.0.0.1:8545",
    WORLD_API_BASE: env.WORLD_API_BASE,
  };
}

/// POST /api/world/context — mint a signed rp_context for the browser's IDKit request.
export function createContextHandler(rawEnv: Record<string, string>) {
  const env = readEnv(rawEnv);
  return async function handle(_req: IncomingMessage, res: ServerResponse) {
    try {
      if (!env.APP_ID || !env.RP_ID || !env.RP_SIGNING_KEY) {
        return json(res, 500, { ok: false, error: "Server missing VITE_WORLD_APP_ID / VITE_WORLD_RP_ID / WORLD_RP_SIGNING_KEY" });
      }
      console.log("[world] /api/world/context requested");
      const sig = signRequest({ signingKeyHex: env.RP_SIGNING_KEY, action: env.ACTION });
      const rp_context = {
        rp_id: env.RP_ID,
        nonce: sig.nonce,
        created_at: sig.createdAt,
        expires_at: sig.expiresAt,
        signature: sig.sig,
      };
      return json(res, 200, { ok: true, rp_context, app_id: env.APP_ID, action: env.ACTION });
    } catch (e: unknown) {
      return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
}

/// POST /api/verify — verify the v4 proof with World, then mint the passport.
export function createVerifyHandler(rawEnv: Record<string, string>) {
  const env = readEnv(rawEnv);
  const arc = defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [env.RPC] } },
  });

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      if (!env.RP_ID) return json(res, 500, { ok: false, error: "Server missing VITE_WORLD_RP_ID" });
      const body = (await readJson(req)) as { result?: Record<string, unknown>; signal?: Address };
      const { result, signal } = body;
      if (!result || !signal) return json(res, 400, { ok: false, error: "missing result or signal" });

      // 1: REAL World ID 4.0 verification. The IDKitResultV4 already has the exact shape the verify
      // endpoint wants (protocol_version, nonce, action, environment, responses[]).
      const vres = await fetch(`${WORLD_API(env.WORLD_API_BASE)}/api/v4/verify/${env.RP_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      const vdata = (await vres.json()) as { success?: boolean; nullifier?: string; code?: string; detail?: string };
      console.log(`[world] /api/verify → World v4 verify: HTTP ${vres.status}`, JSON.stringify(vdata));
      if (!vres.ok || !vdata.success) {
        return json(res, 400, { ok: false, error: `World verify failed: ${vdata.code ?? vres.status}`, detail: vdata.detail });
      }

      // 2: mint the passport on-chain via the relayer. Key it by the REAL RP-scoped nullifier so the
      // anti-respawn mapping binds to the verified human (MockWorldID ignores the proof args on Arc).
      if (!env.RELAYER_PK || !env.PASSPORT) {
        return json(res, 500, { ok: false, error: "Server missing RELAYER_PRIVATE_KEY or VITE_PASSPORT_REGISTRY_ADDRESS" });
      }
      const responses = (result.responses as Array<{ nullifier?: string }> | undefined) ?? [];
      const nullifierHex = vdata.nullifier ?? responses[0]?.nullifier;
      if (!nullifierHex) return json(res, 502, { ok: false, error: "verify ok but no nullifier returned" });

      const account = privateKeyToAccount(env.RELAYER_PK);
      const wallet = createWalletClient({ account, chain: arc, transport: http(env.RPC) });
      const emptyProof = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;
      const txHash = await wallet.writeContract({
        address: env.PASSPORT,
        abi: passportRegistryAbi,
        functionName: "verifyAndMint",
        args: [signal, 0n, BigInt(nullifierHex), emptyProof],
      });

      return json(res, 200, { ok: true, txHash, nullifier: nullifierHex });
    } catch (e: unknown) {
      return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
