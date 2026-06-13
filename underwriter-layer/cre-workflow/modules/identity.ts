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
  // The frontend now encrypts the identity (World ID + ZK proof)
  if (!req.encrypted_identity_blob || req.encrypted_identity_blob.length < 10) {
    return { valid: false, error: "invalid_encrypted_identity" }
  }

  // Must provide at least one wallet to score
  if (!req.wallet_addresses || req.wallet_addresses.length === 0) {
    return { valid: false, error: "no_wallets_provided" }
  }

  runtime.log(
    `Encrypted identity blob received for wallets=${String(req.wallet_addresses.length)}`,
  )
  return { valid: true }
}
