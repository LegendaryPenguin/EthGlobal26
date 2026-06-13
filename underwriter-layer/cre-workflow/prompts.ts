import type { WalletProfile } from "./types"

export const SYSTEM_PROMPT =
  "You are a credit risk analyst for an undercollateralized lending protocol " +
  "serving the unbanked. When wallet data is provided, base your assessment on " +
  "the on-chain evidence. Never include wallet addresses, nullifiers, or " +
  "identifying information in your response."

export function buildClassificationPrompt(profile: WalletProfile, encryptedIdentityBlob: string): string {
  const profileJson = JSON.stringify(
    {
      wallet_count: profile.walletCount,
      total_stablecoin_balance_usdc: profile.totalStablecoinBalanceUsdc,
    },
    null,
    2,
  )

  return (
    `You have received an encrypted identity blob from the frontend:\n` +
    `${encryptedIdentityBlob}\n\n` +
    `[ENCLAVE INSTRUCTION: Decrypt the blob above using your private key to verify the user's WorldID. ` +
    `If the ZK proof is valid, proceed with evaluating the on-chain balances below.]\n\n` +
    `Given the following on-chain wallet profile:\n\n` +
    `${profileJson}\n\n` +
    `Classify this borrower for an undercollateralized credit facility.\n` +
    `Consider:\n` +
    `- Stablecoin balances indicate liquidity and repayment capacity\n` +
    `- Higher risk borrowers go to Junior tranche, lower risk to Senior\n` +
    `- Risk bands: A (lowest risk) through D (highest risk)\n` +
    `- Principal should be between 100 and 10000 USDC based on capacity\n\n` +
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
