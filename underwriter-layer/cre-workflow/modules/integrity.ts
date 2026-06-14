import { sha256, stringToHex } from "viem"

/**
 * Derives a deterministic integrity tag that binds a borrower wallet to a
 * workflow-held secret (WORKFLOW_HMAC_SECRET).
 *
 * The tag is embedded in the inference prompt at submit time (attest.ts) and
 * re-derived at settle time (settle.ts). Because the secret never leaves the
 * workflow, an attacker who self-submits an inference with their own API key
 * cannot produce a valid tag for their wallet — so the on-chain decision is
 * cryptographically bound to a prompt that THIS workflow authored, not merely
 * to "some completed inference that exists at the attester".
 *
 * The borrower address is lower-cased before hashing so checksum casing on
 * either side does not affect the result.
 */
export function deriveIntegrityTag(secret: string, borrowerWallet: string): `0x${string}` {
  return sha256(stringToHex(`${secret}|${borrowerWallet.toLowerCase()}`))
}
