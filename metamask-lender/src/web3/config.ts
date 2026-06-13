import { http, createConfig } from "wagmi";
import { arcTestnet, baseSepolia, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// Real wallet connection for the "Connected" mode. Arc testnet is the settlement hub;
// Base/Eth Sepolia are cross-chain sources. injected() targets the installed MetaMask.
export const config = createConfig({
  chains: [arcTestnet, baseSepolia, sepolia],
  connectors: [injected()],
  transports: {
    // VITE_ARC_RPC_URL lets the local devnet point this at anvil; defaults to live Arc testnet.
    [arcTestnet.id]: http((import.meta as { env?: Record<string, string> }).env?.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network"),
    [baseSepolia.id]: http(),
    [sepolia.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
