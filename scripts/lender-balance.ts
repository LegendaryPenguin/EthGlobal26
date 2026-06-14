/**
 * Show a lender wallet's USDC balances — the wallet you connect with MetaMask in the lender flow.
 *
 *   npm run lender-balance 0xYourMetaMaskAddress
 *   # or set LENDER_ADDRESS in env, or it falls back to the relayer.
 *
 * Prints Arc (the pool/settlement chain) + Base Sepolia (a CCTP source chain) USDC, plus native gas.
 */
import { createPublicClient, http, defineChain, formatUnits, type Address } from "viem";

const ADDR = (process.argv[2] ||
  process.env.LENDER_ADDRESS ||
  "0x9B7c50B1110e911DedbdaF505a63f910fA39ee3d") as Address; // default: relayer

const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const arc = defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } } });
const baseSepolia = defineChain({ id: 84532, name: "Base Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://base-sepolia-rpc.publicnode.com"] } } });

const CHAINS = [
  { chain: arc, usdc: "0x3600000000000000000000000000000000000000" as Address, gas: "USDC", gasDp: 18 },
  { chain: baseSepolia, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address, gas: "ETH", gasDp: 18 },
];

async function main() {
  console.log(`\nLender wallet: ${ADDR}\n`);
  for (const c of CHAINS) {
    try {
      const pub = createPublicClient({ chain: c.chain, transport: http() });
      const [usdc, native] = await Promise.all([
        pub.readContract({ address: c.usdc, abi: erc20, functionName: "balanceOf", args: [ADDR] }),
        pub.getBalance({ address: ADDR }),
      ]);
      console.log(`  ${c.chain.name.padEnd(14)}  USDC ${formatUnits(usdc as bigint, 6).padStart(12)}   ${c.gas} (gas) ${formatUnits(native, c.gasDp)}`);
    } catch (e) {
      console.log(`  ${c.chain.name.padEnd(14)}  error: ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`);
    }
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
