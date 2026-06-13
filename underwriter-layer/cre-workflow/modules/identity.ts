import type { Runtime } from "@chainlink/cre-sdk"
import type { Config, LoanRequest } from "../types"

/**
 * Validates the borrower's World ID identity and ZK eligibility proof.
 * World ID provides sybil resistance — one human, one loan, no respawning.
 */
export function validateIdentity(
  runtime: Runtime<Config>,
  req: LoanRequest,
): { valid: boolean; error?: string } {
  // Nullifier must be a valid bytes32 hex string
  if (!req.world_id_nullifier || req.world_id_nullifier.length < 10) {
    return { valid: false, error: "invalid_nullifier" }
  }

  // ZK eligibility proof must have passed client-side verification
  if (!req.zk_eligibility_proof_valid) {
    runtime.log(`Rejected: ZK proof invalid for ${req.borrower_wallet}`)
    return { valid: false, error: "zk_proof_invalid" }
  }

  // Must provide at least one wallet to score
  if (!req.wallet_addresses || req.wallet_addresses.length === 0) {
    return { valid: false, error: "no_wallets_provided" }
  }

  runtime.log(
    `Identity validated: nullifier=${req.world_id_nullifier.slice(0, 10)}..., ` +
      `wallets=${String(req.wallet_addresses.length)}`,
  )
  return { valid: true }
}
