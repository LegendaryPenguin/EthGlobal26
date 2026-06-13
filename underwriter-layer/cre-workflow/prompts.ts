import type { WalletProfile } from "./types"

export const SYSTEM_PROMPT =
  "You are a credit risk analyst for an undercollateralized lending protocol " +
  "serving the unbanked. You evaluate borrowers using a combination of " +
  "self-reported identity data (decrypted from a confidential blob) and " +
  "on-chain wallet evidence. Never include wallet addresses, nullifiers, or " +
  "identifying information in your response."

export function buildClassificationPrompt(profile: WalletProfile, encryptedIdentityBlob: string, borrowerWallet: string): string {
  const profileJson = JSON.stringify(
    {
      wallet_count: profile.walletCount,
      total_stablecoin_balance_usdc: profile.totalStablecoinBalanceUsdc,
    },
    null,
    2,
  )

  return (
    `Borrower wallet: ${borrowerWallet}\n\n` +
    `You have received an encrypted identity blob from the frontend:\n` +
    `${encryptedIdentityBlob}\n\n` +
    `[ENCLAVE INSTRUCTION: In production, you would decrypt this RSA ciphertext using your TEE private key. ` +
    `Because this is a hackathon demo, the frontend has Base64-encoded a JSON object. ` +
    `Please Base64-decode the blob above. It contains the following fields:\n` +
    `  - world_id_nullifier: the user's World ID proof of unique humanity\n` +
    `  - zk_eligibility_proof_valid: boolean confirming ZK proof passed\n` +
    `  - age: the borrower's age (must be >= 18 or reject)\n` +
    `  - country: free-text residing country name\n` +
    `  - occupation: free-text occupation string\n` +
    `  - self_reported_yearly_income_usd: self-reported annual income in USD\n` +
    `Verify that zk_eligibility_proof_valid is true and age >= 18. If either check fails, set approved to false.]\n\n` +
    `Given the following on-chain wallet profile:\n\n` +
    `${profileJson}\n\n` +
    `Classify this borrower for an undercollateralized credit facility.\n` +
    `Weigh these factors:\n` +
    `- Age: borrowers under 18 must be rejected outright\n` +
    `- Country: consider regional economic context and regulatory risk\n` +
    `- Occupation: stable employment (e.g. salaried engineer) is lower risk than informal/gig work\n` +
    `- Self-reported income vs. on-chain stablecoin balance: large discrepancies are a red flag\n` +
    `- Stablecoin balances: indicate liquidity and repayment capacity\n` +
    `- Higher risk borrowers go to Junior tranche, lower risk to Senior\n` +
    `- Risk bands: A (lowest risk) through D (highest risk)\n` +
    `- Principal should be between 100 and 10000 USDC, scaled to income and on-chain evidence\n\n` +
    `Respond with ONLY a valid JSON object:\n` +
    `{\n` +
    `  "approved": true,\n` +
    `  "principal": "500 USDC",\n` +
    `  "tranche": "Senior|Junior",\n` +
    `  "riskBand": "A|B|C|D"\n` +
    `}\n` +
    `Do not include markdown formatting, code fences, or any text outside the JSON object.`
  )
}
