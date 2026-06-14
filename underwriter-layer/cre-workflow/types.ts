import { z } from "zod"

// ---------------------------------------------------------------------------
// Inbound request from frontend
// ---------------------------------------------------------------------------

export const loanRequestSchema = z.object({
  borrower_wallet: z.string(),
  requested_principal: z.string(), // e.g., "5000 USDC"
  wallet_addresses: z.array(z.string()).min(1),
  encrypted_identity_blob: z.string(),
})

export type LoanRequest = z.infer<typeof loanRequestSchema>

// ---------------------------------------------------------------------------
// Wallet profile built from on-chain reads
// ---------------------------------------------------------------------------

export type WalletProfile = {
  walletCount: number
  totalStablecoinBalanceUsdc: number
}

// ---------------------------------------------------------------------------
// Credit decision from Confidential AI Attester
// ---------------------------------------------------------------------------

export const creditDecisionSchema = z.object({
  approved: z.boolean(),
  // On denial the model frequently returns null for these; allow it and
  // coerce to "" at settle time (the on-chain fields are non-nullable strings).
  principal: z.string().nullable().optional(),   // e.g. "500 USDC"
  tranche: z.string().nullable().optional(),     // "Senior" | "Junior"
  riskBand: z.string().nullable().optional(),    // "A" | "B" | "C" | "D"
  // Short, generic explanation when denied; null when approved.
  // Must never contain confidential/identifying data.
  denialReason: z.string().nullable().optional(),
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
  authorizedKeys: { type?: "KEY_TYPE_UNSPECIFIED" | "KEY_TYPE_ECDSA_EVM"; publicKey?: string }[]
  usdcAddress: string
  creCallbackUrl: string
}

// ---------------------------------------------------------------------------
// Inference Callback Payload
// ---------------------------------------------------------------------------

export type InferenceCallback = {
  id?: string
  status?: string // "completed" | "failed"
  output?: string // LLM decision as JSON, wrapped in a ```json fence
  resource_summaries?: { digest?: string; filename?: string }[]
  resources?: { digest?: string; request_digest?: string; response_digest?: string }[]
}
