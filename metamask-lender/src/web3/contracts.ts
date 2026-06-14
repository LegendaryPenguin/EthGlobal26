// Real on-chain config for the Connected mode (Phase 1+). Addresses verified live on
// Arc testnet 2026-06-13. USDC = 6 decimals everywhere. (DESIGN_SPEC / docs/03)
import type { ChainId } from "../data/mock";

// Env override (set by scripts/devnet.sh for local devnet); defaults to the live Arc testnet
// deployment. Unifies addresses across borrower app, lender app, and underwriter (Phase 4).
const ENV = (import.meta as { env?: Record<string, string> }).env ?? {};

// Vouch contracts deployed on Arc Testnet (5042002).
export const ARC_TRANCHE_POOL = (ENV.VITE_TRANCHE_POOL_ADDRESS as `0x${string}` | undefined) ?? "0x73bfc359df81c897ee7c04c778c2491ccb53f4d7";

// MarketRateEngine on Arc — the on-chain dynamic rate/yield brain (Track 1).
export const RATE_ENGINE = (ENV.VITE_RATE_ENGINE_ADDRESS as `0x${string}` | undefined) ?? "0x74D8d8BFBDcdDaf888e1f745f071afFB566919dB";
export const marketRateEngineAbi = [
  { type: "function", name: "currentBorrowAprBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "currentSupplyYieldBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "utilizationBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "willingLenders", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "willingBorrowers", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
] as const;

// USDC token address per source chain (testnet).
export const USDC_ADDRESS: Partial<Record<ChainId, `0x${string}`>> = {
  arc: (ENV.VITE_USDC_ADDRESS as `0x${string}` | undefined) ?? "0x3600000000000000000000000000000000000000",
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
