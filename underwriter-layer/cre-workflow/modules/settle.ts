import {
  EVMClientCapability,
  type Runtime,
} from "@chainlink/cre-sdk"
import {
  encodeAbiParameters,
  parseAbiParameters,
  stringToHex,
} from "viem"
import type { Config, CreditDecision } from "../types"

/**
 * ABI-encodes the credit decision and writes it on-chain to the
 * CreditRegistry consumer contract via CRE's signed report mechanism.
 *
 * Report schema:
 *   (address borrower, bool approved, uint256 principalUsdc,
 *    bytes32 tranche, bytes32 riskBand, bytes32 worldIdNullifier)
 *
 * The KeystoneForwarder validates the DON signature and forwards
 * the report to the CreditRegistry.onReport() function.
 */
export function settleOnChain(
  runtime: Runtime<Config>,
  borrowerWallet: string,
  worldIdNullifier: string,
  decision: CreditDecision,
): { txHash: string; txStatus: string } {
  const evmClient = new EVMClientCapability()

  // Parse principal from AI response (e.g. "500 USDC" → 500_000_000)
  const principalMatch = decision.principal.match(/^(\d+)/)
  const principalUsdc = principalMatch
    ? BigInt(principalMatch[1]) * 1_000_000n
    : 0n

  // Encode tranche and riskBand as padded bytes32
  const trancheBytes32 = stringToHex(decision.tranche, { size: 32 })
  const riskBandBytes32 = stringToHex(decision.riskBand, { size: 32 })

  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "address borrower, bool approved, uint256 principalUsdc, bytes32 tranche, bytes32 riskBand, bytes32 worldIdNullifier",
    ),
    [
      borrowerWallet as `0x${string}`,
      decision.approved,
      principalUsdc,
      trancheBytes32,
      riskBandBytes32,
      worldIdNullifier as `0x${string}`,
    ],
  )

  const signedReport = runtime.report(encoded)

  const txResult = evmClient
    .writeReport(runtime, {
      toAddress: runtime.config.consumerAddress,
      chainSelectorName: runtime.config.chainSelectorName,
      report: signedReport,
      gasLimit: 500_000n,
    })
    .result()

  runtime.log(`TX hash: ${txResult.txHash}, status: ${txResult.txStatus}`)

  return { txHash: txResult.txHash, txStatus: txResult.txStatus }
}
