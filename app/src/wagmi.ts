import { http, createConfig } from "wagmi";
import { arcTestnet } from "wagmi/chains";
import { metaMask, injected } from "wagmi/connectors";

/// Arc Testnet (chain id 5042002) comes from wagmi/viem built-ins — no custom chain def needed
/// (CLAUDE.md toolchain note). MetaMask is the borrower's wallet here (per request); Circle
/// embedded wallets can be added as a second connector later for non-crypto onboarding (docs/03).
const rpcOverride = import.meta.env.VITE_ARC_RPC_URL as string | undefined;

export const config = createConfig({
  chains: [arcTestnet],
  connectors: [metaMask(), injected()],
  transports: {
    [arcTestnet.id]: http(rpcOverride || undefined),
  },
});

export { arcTestnet };

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
