import type { WalletProfile } from "./types"

export const SYSTEM_PROMPT =
  "You are a credit risk analyst for an undercollateralized lending protocol " +
  "serving the unbanked. When wallet data is provided, base your assessment on " +
  "the on-chain evidence. Never include wallet addresses, nullifiers, or " +
  "identifying information in your response."

export function buildClassificationPrompt(profile: WalletProfile): string {
  const profileJson = JSON.stringify(
    {
      wallet_count: profile.walletCount,
      total_stablecoin_balance_usdc: profile.totalStablecoinBalanceUsdc,
      wallet_age_days: profile.walletAgeDays,
      total_transactions: profile.totalTransactions,
      defi_protocols_used: profile.defiProtocolsUsed,
    },
    null,
    2,
  )

  return (
    `Given the following on-chain wallet profile for a verified unique human ` +
    `(identity protected — do not include wallet addresses in your response):\n\n` +
    `${profileJson}\n\n` +
    `Classify this borrower for an undercollateralized credit facility.\n` +
    `Consider:\n` +
    `- Wallet age and transaction history indicate reliability\n` +
    `- Stablecoin balances indicate liquidity and repayment capacity\n` +
    `- DeFi protocol usage indicates on-chain sophistication\n` +
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
