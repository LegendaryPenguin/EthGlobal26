import {
  EVMClient,
  type Runtime,
} from "@chainlink/cre-sdk"
import {
  parseAbi,
  encodeFunctionData,
  decodeFunctionResult,
  formatUnits,
  bytesToHex,
  hexToBytes,
} from "viem"
import type { Config, LoanRequest, WalletProfile } from "../types"

const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
])

const LAST_FINALIZED_BLOCK = 0n

/**
 * Builds a WalletProfile by combining:
 * - On-chain EVM reads (stablecoin balances via balanceOf)
 * - Frontend-provided context (wallet age, tx count, DeFi protocols)
 *
 * The EVM reads are the trusted part — CRE nodes verify these independently.
 * Frontend context is supplementary and can be enriched over time with
 * additional on-chain reads or indexer API calls.
 */
export function getWalletScore(
  runtime: Runtime<Config>,
  req: LoanRequest,
): WalletProfile {
  const evmClient = new EVMClient(EVMClient.SUPPORTED_CHAIN_SELECTORS["ethereum-testnet-sepolia"])
  let totalStablecoinBalance = 0n

  // Read USDC balance for each connected wallet
  for (const wallet of req.wallet_addresses) {
    const callData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet as `0x${string}`],
    })

    try {
      const result = evmClient
        .callContract(runtime, {
          call: {
            to: hexToBytes(runtime.config.usdcAddress as `0x${string}`),
            data: hexToBytes(callData),
          } as any,
        })
        .result()

      const decoded = decodeFunctionResult({
        abi: erc20Abi,
        functionName: "balanceOf",
        data: bytesToHex(result.data as any),
      })

      // decodeFunctionResult returns the balance directly for single return values
      const balance = decoded as unknown as bigint
      totalStablecoinBalance += balance
    } catch (e) {
      runtime.log(`Warning: balance read failed for ${wallet}: ${String(e)}`)
    }
  }

  const profile: WalletProfile = {
    walletCount: req.wallet_addresses.length,
    totalStablecoinBalanceUsdc: Number(formatUnits(totalStablecoinBalance, 6)),
  }

  runtime.log(
    `Wallet score: ${String(profile.walletCount)} wallets, ` +
      `$${String(profile.totalStablecoinBalanceUsdc)} USDC`,
  )

  return profile
}
