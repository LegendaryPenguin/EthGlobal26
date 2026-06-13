import {
  HTTPCapability,
  CronCapability,
  handler,
  Runner,
  type Runtime,
  type HTTPTriggerPayload,
} from "@chainlink/cre-sdk"
import type { Config } from "./types"
import { loanRequestSchema } from "./types"
import { validateIdentity } from "./modules/identity"
import { getWalletScore } from "./modules/wallet-score"
import { assessAndClassify } from "./modules/attest"
import { settleOnChain } from "./modules/settle"

// ---------------------------------------------------------------------------
// Handler 1 — HTTP Trigger: Loan Application Pipeline
// ---------------------------------------------------------------------------
//
//   validate(identity) → scoreWallets(evm) → attest(ai) → settle(evm)
//

const onLoanApplication = (
  runtime: Runtime<Config>,
  triggerEvent: HTTPTriggerPayload,
): string => {
  // --- Parse & validate inbound request ---
  const body = triggerEvent.body as Record<string, unknown>
  const parsed = loanRequestSchema.safeParse(body)
  if (!parsed.success) {
    runtime.log(`Invalid request: ${parsed.error.message}`)
    return JSON.stringify({ error: "invalid_request", detail: parsed.error.message })
  }
  const req = parsed.data
  runtime.log(`Loan application received for ${req.borrower_wallet}`)

  // --- 1. Identity gate (World ID + ZK proof) ---
  const identity = validateIdentity(runtime, req)
  if (!identity.valid) {
    return JSON.stringify({ error: identity.error })
  }

  // --- 2. On-chain wallet scoring (EVM reads) ---
  const walletProfile = getWalletScore(runtime, req)

  // --- 3. Confidential AI classification (TEE) ---
  let decision
  try {
    decision = assessAndClassify(runtime, walletProfile)
  } catch (e) {
    runtime.log(`AI classification failed: ${String(e)}`)
    return JSON.stringify({ error: "ai_classification_failed", detail: String(e) })
  }

  // --- 4. Settle on-chain ---
  const tx = settleOnChain(
    runtime,
    req.borrower_wallet,
    req.world_id_nullifier,
    decision,
  )

  return JSON.stringify({
    borrower: req.borrower_wallet,
    approved: decision.approved,
    principal: decision.principal,
    tranche: decision.tranche,
    riskBand: decision.riskBand,
    txHash: tx.txHash,
  })
}

// ---------------------------------------------------------------------------
// Handler 2 — Cron Trigger: Heartbeat
// ---------------------------------------------------------------------------

const onHeartbeat = (runtime: Runtime<Config>): string => {
  runtime.log(
    `[Heartbeat] Credit Underwriter alive at ${runtime.now().toISOString()}`,
  )
  return "heartbeat-ok"
}

// ---------------------------------------------------------------------------
// Workflow init
// ---------------------------------------------------------------------------

const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  const http = new HTTPCapability()

  return [
    handler(cron.trigger({ schedule: config.schedule }), onHeartbeat),
    handler(
      http.trigger({ authorizedKeys: config.authorizedKeys }),
      onLoanApplication,
    ),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
