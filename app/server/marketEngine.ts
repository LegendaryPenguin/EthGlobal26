// Vouch — market simulator + reader for the on-chain MarketRateEngine (Arc, Track 1).
//
// GET  /api/market  → read the engine's current conditions + computed rates (no tx).
// POST /api/market  → advance the global market one realistic step (random-walk nudge of base rate,
//                     willing lenders/borrowers, supply/demand) and push it ON-CHAIN via the engine's
//                     marketAdmin (the relayer), which recomputes + persists the borrow APR and lender
//                     expected yield. The walk state lives ON-CHAIN, so it survives serverless restarts.
//
// This is the off-chain "realistic global market" feed the bounty asks for; the *formula* is on-chain.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPublicClient, createWalletClient, http, defineChain, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/// Deployed on Arc testnet. Override with VITE_RATE_ENGINE_ADDRESS if redeployed.
export const RATE_ENGINE_DEFAULT = "0x74D8d8BFBDcdDaf888e1f745f071afFB566919dB" as Address;

const ENGINE_ABI = [
  { type: "function", name: "baseRateBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "willingLenders", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "willingBorrowers", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "totalSuppliedUsdc", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalBorrowedUsdc", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "currentBorrowAprBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "currentSupplyYieldBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "utilizationBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastPokeAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  {
    type: "function", name: "pushAndPoke", stateMutability: "nonpayable",
    inputs: [{ type: "uint16" }, { type: "uint32" }, { type: "uint32" }, { type: "uint256" }, { type: "uint256" }],
    outputs: [],
  },
] as const;

const arc = (rpc: string) =>
  defineChain({ id: 5042002, name: "arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const nudge = (x: number, step: number, lo: number, hi: number) => clamp(Math.round(x + (Math.random() * 2 - 1) * step), lo, hi);

function json(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/// Read the engine's live market-priced borrow APR (bps) for a risk band, so the LoanRegistry terms
/// reflect on-chain conditions. Returns null on any error (caller falls back to the static APR).
export async function engineBorrowAprBps(raw: Record<string, string>, band: number): Promise<number | null> {
  try {
    const rpc = raw.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network";
    const engine = (raw.VITE_RATE_ENGINE_ADDRESS || RATE_ENGINE_DEFAULT) as Address;
    const pub = createPublicClient({ chain: arc(rpc), transport: http(rpc) });
    const apr = await pub.readContract({
      address: engine,
      abi: [{ type: "function", name: "borrowAprForBand", stateMutability: "view", inputs: [{ type: "uint8" }], outputs: [{ type: "uint16" }] }] as const,
      functionName: "borrowAprForBand",
      args: [band],
    });
    return Number(apr);
  } catch {
    return null;
  }
}

export function createMarketHandler(raw: Record<string, string>) {
  const rpc = raw.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network";
  const engine = (raw.VITE_RATE_ENGINE_ADDRESS || RATE_ENGINE_DEFAULT) as Address;
  const relayerPk = raw.RELAYER_PRIVATE_KEY as Hex | undefined;

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chain = arc(rpc);
      const pub = createPublicClient({ chain, transport: http(rpc) });
      const read = (fn: string) => pub.readContract({ address: engine, abi: ENGINE_ABI, functionName: fn as never });

      let base = Number(await read("baseRateBps"));
      let lenders = Number(await read("willingLenders"));
      let borrowers = Number(await read("willingBorrowers"));
      let suppliedStr = (await read("totalSuppliedUsdc")) as bigint;
      let borrowedStr = (await read("totalBorrowedUsdc")) as bigint;
      let txHash: string | undefined;

      // POST advances the market one realistic step and writes it on-chain. GET is read-only.
      if (req.method === "POST" && relayerPk) {
        const nBase = nudge(base || 350, 40, 200, 600);            // global benchmark rate drifts
        const nLenders = nudge(lenders || 40, 6, 15, 95);          // willing suppliers
        const nBorrowers = nudge(borrowers || 50, 6, 15, 95);      // willing borrowers
        // Simulated global market size + utilization driven by the borrower/lender ratio.
        const mktSupplied = BigInt(Math.round(40_000 + nLenders * 1_200)) * 1_000_000n; // USDC, 6dp
        const util = clamp(0.15 + 0.7 * (nBorrowers / (nBorrowers + nLenders)), 0.05, 0.97);
        const mktBorrowed = BigInt(Math.round((Number(mktSupplied) / 1e6) * util)) * 1_000_000n;

        const account = privateKeyToAccount(relayerPk);
        const wallet = createWalletClient({ account, chain, transport: http(rpc) });
        const tx = await wallet.writeContract({
          address: engine, abi: ENGINE_ABI, functionName: "pushAndPoke",
          args: [nBase, nLenders, nBorrowers, mktSupplied, mktBorrowed],
        });
        await pub.waitForTransactionReceipt({ hash: tx });
        txHash = tx;
        base = nBase; lenders = nLenders; borrowers = nBorrowers; suppliedStr = mktSupplied; borrowedStr = mktBorrowed;
      }

      const apr = Number(await read("currentBorrowAprBps"));
      const yld = Number(await read("currentSupplyYieldBps"));
      const util = Number(await read("utilizationBps"));
      const lastPokeAt = Number(await read("lastPokeAt"));

      json(res, 200, {
        ok: true,
        engine,
        txHash,
        conditions: {
          baseRateBps: base,
          willingLenders: lenders,
          willingBorrowers: borrowers,
          suppliedUsdc: suppliedStr.toString(),
          borrowedUsdc: borrowedStr.toString(),
        },
        rates: { borrowAprBps: apr, supplyYieldBps: yld, utilizationBps: util, lastPokeAt },
      });
    } catch (e) {
      json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
}
