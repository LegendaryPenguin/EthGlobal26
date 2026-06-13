/**
 * Stage 0 milestone check (docs/06): confirm we can talk to Arc Testnet, that gas is denominated
 * in USDC (18-dec native), and — if an ERC-20 USDC address is supplied — that it reports 6 decimals.
 * This locks in the decimals handling (Golden Rule #4) before any money-layer code.
 *
 *   ARC_RPC_URL=... USDC_ADDRESS=0x... [ADDRESS=0x...] npm run check-arc
 */
import { createPublicClient, http, formatUnits, isAddress, type Address } from "viem";
import { arcTestnet } from "./arc.js";

const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function main() {
  const client = createPublicClient({ chain: arcTestnet, transport: http() });

  const chainId = await client.getChainId();
  console.log(`Connected to ${arcTestnet.name} — chainId ${chainId}`);
  if (chainId !== 5042002) {
    throw new Error(`Expected Arc Testnet (5042002) but got ${chainId} — refusing (Golden Rule #3).`);
  }

  const account = process.env.ADDRESS as Address | undefined;
  if (account && isAddress(account)) {
    const wei = await client.getBalance({ address: account });
    // native gas token = 18 decimals
    console.log(`Native (gas) USDC balance of ${account}: ${formatUnits(wei, 18)} USDC`);
  } else {
    console.log("Tip: set ADDRESS=0x… to print a native (gas) balance.");
  }

  const usdc = process.env.USDC_ADDRESS as Address | undefined;
  if (usdc && isAddress(usdc)) {
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address: usdc, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: usdc, abi: erc20Abi, functionName: "symbol" }),
    ]);
    console.log(`ERC-20 ${symbol} at ${usdc}: ${decimals} decimals`);
    if (decimals !== 6) {
      console.warn(`⚠️  Expected 6 decimals for USDC; got ${decimals}. Double-check the address.`);
    }
    if (account && isAddress(account)) {
      const bal = await client.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      });
      console.log(`ERC-20 USDC balance of ${account}: ${formatUnits(bal, decimals)} ${symbol}`);
    }
  } else {
    console.log("Set USDC_ADDRESS=0x… (from the Circle MCP / address page) to verify 6-dec USDC.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
