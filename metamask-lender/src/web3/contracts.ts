// Real on-chain config for the Connected mode (Phase 1+). Addresses verified live on
// Arc testnet 2026-06-13. USDC = 6 decimals everywhere. (DESIGN_SPEC / docs/03)
import type { ChainId } from "../data/mock";

// Vouch contracts deployed on Arc Testnet (5042002).
export const ARC_TRANCHE_POOL = "0x602dB37B2275450717Aa8f1935dC5bbF24a70E0d" as const;

// USDC token address per source chain (testnet).
export const USDC_ADDRESS: Partial<Record<ChainId, `0x${string}`>> = {
  arc: "0x3600000000000000000000000000000000000000",
  base: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia USDC
  ethereum: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Eth Sepolia USDC
};

// Map our UI ChainId -> the wagmi/viem numeric chain id we actually connect to.
// (Sources are testnets: Arc 5042002, Base Sepolia 84532, Eth Sepolia 11155111.)
export const WAGMI_CHAIN_ID: Partial<Record<ChainId, 5042002 | 84532 | 11155111>> = {
  arc: 5042002,
  base: 84532,
  ethereum: 11155111,
};

export const ARC_CHAIN_ID = 5042002 as const;

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export const tranchePoolAbi = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "tranche", type: "uint8" }, { name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "tranche", type: "uint8" }, { name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "assetsOf", stateMutability: "view", inputs: [{ name: "lender", type: "address" }, { name: "tranche", type: "uint8" }], outputs: [{ type: "uint256" }] },
] as const;
