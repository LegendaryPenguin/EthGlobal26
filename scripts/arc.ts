import { arcTestnet as viemArcTestnet } from "viem/chains";
import type { Chain } from "viem";

/// Arc Testnet (Circle's L1) — TESTNET ONLY, chain id 5042002 (Golden Rule #3).
/// Per CLAUDE.md, viem supports Arc out of the box — we reuse viem's built-in `arcTestnet`
/// (canonical RPC, ArcScan, 18-dec native USDC) rather than hand-rolling a chain def, and only
/// override the RPC if ARC_RPC_URL is set. The ERC-20 USDC used for loans is a separate 6-decimal
/// token whose address comes from the Circle MCP / address page (Golden Rule #5) — never hardcoded.
const rpcOverride = process.env.ARC_RPC_URL;

export const arcTestnet: Chain = rpcOverride
  ? { ...viemArcTestnet, rpcUrls: { ...viemArcTestnet.rpcUrls, default: { http: [rpcOverride] } } }
  : viemArcTestnet;

// Sanity guard so nobody points this at the wrong network.
if (arcTestnet.id !== 5042002) {
  throw new Error(`Expected Arc Testnet (5042002), got ${arcTestnet.id}`);
}
