import { z } from "zod"

// ---------------------------------------------------------------------------
// Inbound request from frontend
// ---------------------------------------------------------------------------

export const walletContextSchema = z.object({
  wallet_age_days: z.number().optional().default(0),
  total_transactions: z.number().optional().default(0),
  defi_protocols_used: z.array(z.string()).optional().default([]),
})

export const loanRequestSchema = z.object({
  borrower_wallet: z.string(),
  wallet_addresses: z.array(z.string()).min(1),
  world_id_nullifier: z.string(),
  zk_eligibility_proof_valid: z.boolean(),
  wallet_context: walletContextSchema.optional().default({}),
})

export type LoanRequest = z.infer<typeof loanRequestSchema>

// ---------------------------------------------------------------------------
// Wallet profile built from on-chain reads + frontend context
// ---------------------------------------------------------------------------

export type WalletProfile = {
  walletCount: number
  totalStablecoinBalanceUsdc: number
  walletAgeDays: number
  totalTransactions: number
  defiProtocolsUsed: string[]
}

// ---------------------------------------------------------------------------
// Credit decision from Confidential AI Attester
// ---------------------------------------------------------------------------

export const creditDecisionSchema = z.object({
  approved: z.boolean(),
  principal: z.string(),   // e.g. "500 USDC"
  tranche: z.string(),     // "Senior" | "Junior"
  riskBand: z.string(),    // "A" | "B" | "C" | "D"
})

export type CreditDecision = z.infer<typeof creditDecisionSchema>

// ---------------------------------------------------------------------------
// Workflow config
// ---------------------------------------------------------------------------

export type Config = {
  schedule: string
  confAiBaseUrl: string
  confAiModel: string
  chainSelectorName: string
  consumerAddress: string
  authorizedKeys: string[]
  usdcAddress: string
}
