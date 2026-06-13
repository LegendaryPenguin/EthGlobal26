// Server-side World ID verification (Path A — cloud verify). DEV-ONLY: wired as a Vite middleware
// in vite.config.ts, so it runs in Node alongside `npm run dev` and the relayer key never reaches
// the browser bundle (no VITE_ prefix). Flow:
//   1. The browser sends the IDKit proof + the signal (connected wallet) to POST /api/verify.
//   2. We verify the proof against World's cloud API (real ZK + nullifier check) via verifyCloudProof.
//   3. On success, a relayer wallet mints the ERC-8004 passport on-chain (PassportRegistry.verifyAndMint).
// On Arc there is no World ID Router to verify in-contract (docs/05), so the real validation happens
// here in step 2 — which the World ID track explicitly permits ("backend OR on-chain").
import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyCloudProof } from "@worldcoin/idkit-core/backend";
import { createWalletClient, http, decodeAbiParameters, defineChain, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { passportRegistryAbi } from "../src/abis/passportRegistry";

/// The subset of the IDKit ISuccessResult we forward. Typed locally so this Node module never has to
/// import the React idkit package.
interface WorldProof {
  merkle_root: string;
  nullifier_hash: string;
  proof: string;
  verification_level: string;
}

export function createVerifyHandler(env: Record<string, string>) {
  const APP_ID = env.VITE_WORLD_APP_ID as `app_${string}` | undefined;
  const ACTION = env.VITE_WORLD_ACTION_ID || "mint-credit-passport";
  const RELAYER_PK = env.RELAYER_PRIVATE_KEY as Hex | undefined;
  const PASSPORT = env.VITE_PASSPORT_REGISTRY_ADDRESS as Address | undefined;
  const RPC = env.VITE_ARC_RPC_URL || "http://127.0.0.1:8545";

  // Arc testnet chain id is 5042002; for the local devnet RPC points at anvil on the same id.
  const arc = defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      if (!APP_ID) return json(res, 500, { ok: false, error: "Server missing VITE_WORLD_APP_ID" });

      const body = (await readJson(req)) as { proof?: WorldProof; signal?: Address };
      const { proof, signal } = body;
      if (!proof || !signal) return json(res, 400, { ok: false, error: "missing proof or signal" });

      // 1 + 2: REAL World ID verification (proof + nullifier) against World's cloud API. The signal
      // (wallet address) is hashed by verifyCloudProof and must match what IDKit signed in the browser.
      const verify = await verifyCloudProof(proof as Parameters<typeof verifyCloudProof>[0], APP_ID, ACTION, signal);
      if (!verify.success) {
        return json(res, 400, { ok: false, error: `World verify failed: ${verify.code ?? "unknown"}`, detail: verify.detail });
      }

      // 3: mint the passport on-chain via the relayer (it pays gas). Trust now rests on step 2.
      if (!RELAYER_PK || !PASSPORT) {
        return json(res, 500, { ok: false, error: "Server missing RELAYER_PRIVATE_KEY or VITE_PASSPORT_REGISTRY_ADDRESS" });
      }
      const account = privateKeyToAccount(RELAYER_PK);
      const wallet = createWalletClient({ account, chain: arc, transport: http(RPC) });

      const root = BigInt(proof.merkle_root);
      const nullifierHash = BigInt(proof.nullifier_hash);
      const proofArr = decodeAbiParameters([{ type: "uint256[8]" }], proof.proof as Hex)[0] as readonly bigint[];

      const txHash = await wallet.writeContract({
        address: PASSPORT,
        abi: passportRegistryAbi,
        functionName: "verifyAndMint",
        args: [signal, root, nullifierHash, proofArr],
      });

      return json(res, 200, { ok: true, txHash });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return json(res, 500, { ok: false, error: message });
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
