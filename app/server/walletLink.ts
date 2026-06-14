// Vouch — wallet ↔ World ID binding (anti-Sybil). The relayer (the World-ID-verifying server) is the
// authorized linker on the WalletLink contract on Arc. POST /api/world/link-wallet records that a
// connected wallet belongs to the current human; the contract reverts if that wallet is already tied
// to a different World ID (the "can't attach this wallet to a new identity" guarantee).
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPublicClient, createWalletClient, http, defineChain, numberToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/// Deployed on Arc testnet. Override with VITE_WALLET_LINK_ADDRESS if redeployed.
export const WALLET_LINK_DEFAULT = "0x263999c1A58a37dc4554689Fa76eC4adc0429b0e" as Address;

const WALLET_LINK_ABI = [
  { type: "function", name: "link", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bytes32" }], outputs: [] },
  { type: "function", name: "worldIdOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32" }] },
] as const;

const arc = (rpc: string) =>
  defineChain({ id: 5042002, name: "arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });

function json(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readJson(req: IncomingMessage): Promise<unknown> {
  const pre = (req as { body?: unknown }).body;
  if (pre !== undefined) return Promise.resolve(typeof pre === "string" ? JSON.parse(pre) : pre);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

/// Normalise a World ID nullifier (any-length hex / decimal) to a bytes32 the contract accepts.
function toBytes32(nullifier: string): Hex {
  return numberToHex(BigInt(nullifier), { size: 32 });
}

export function createLinkWalletHandler(raw: Record<string, string>) {
  const rpc = raw.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network";
  const link = (raw.VITE_WALLET_LINK_ADDRESS || WALLET_LINK_DEFAULT) as Address;
  const relayerPk = raw.RELAYER_PRIVATE_KEY as Hex | undefined;

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!relayerPk) return json(res, 500, { ok: false, error: "server not configured" });
      const { sessionNullifier, wallet } = (await readJson(req)) as { sessionNullifier?: string; wallet?: string };
      if (!sessionNullifier || !wallet) return json(res, 400, { ok: false, error: "missing sessionNullifier or wallet" });

      const chain = arc(rpc);
      const pub = createPublicClient({ chain, transport: http(rpc) });
      const worldId = toBytes32(sessionNullifier);

      // Pre-check so we return a friendly verdict instead of a raw revert.
      const existing = (await pub.readContract({ address: link, abi: WALLET_LINK_ABI, functionName: "worldIdOf", args: [wallet as Address] })) as Hex;
      const zero = "0x0000000000000000000000000000000000000000000000000000000000000000";
      if (existing !== zero) {
        const sameHuman = existing.toLowerCase() === worldId.toLowerCase();
        return json(res, sameHuman ? 200 : 409, {
          ok: sameHuman,
          alreadyLinked: true,
          sameHuman,
          linkedWorldId: existing,
          error: sameHuman ? undefined : "wallet_already_linked",
          detail: sameHuman ? "This wallet is already linked to this World ID." : "This wallet is already associated with a different World ID — it can't be linked to another.",
        });
      }

      const account = privateKeyToAccount(relayerPk);
      const wallet_ = createWalletClient({ account, chain, transport: http(rpc) });
      const tx = await wallet_.writeContract({ address: link, abi: WALLET_LINK_ABI, functionName: "link", args: [wallet as Address, worldId] });
      await pub.waitForTransactionReceipt({ hash: tx });
      return json(res, 200, { ok: true, alreadyLinked: false, txHash: tx, linkedWorldId: worldId });
    } catch (e) {
      return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
}
