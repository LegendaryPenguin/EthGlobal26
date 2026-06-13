import {
  HTTPCapability,
  CronCapability,
  handler,
  Runner,
  type Runtime,
  type HTTPPayload,
} from "@chainlink/cre-sdk"
import type { Config } from "./types"
import { loanRequestSchema } from "./types"
import { validateIdentity } from "./modules/identity"
import { getWalletScore } from "./modules/wallet-score"
import { assessAndClassify } from "./modules/attest"
import { processInferenceCallback } from "./modules/settle"

// ---------------------------------------------------------------------------
// Handler 1 — HTTP Trigger: Loan Application Pipeline
// ---------------------------------------------------------------------------
//
//   validate(identity) → scoreWallets(evm) → attest(ai) → exit
//

const onLoanApplication = (
  runtime: Runtime<Config>,
  triggerEvent: HTTPPayload,
): string => {
  // --- Parse & validate inbound request ---
  let rawBody = ""
  const inputObj = (triggerEvent as any).input
  if (inputObj && Array.isArray(inputObj.data)) {
    rawBody = new TextDecoder().decode(new Uint8Array(inputObj.data))
  } else if (inputObj instanceof Uint8Array) {
    rawBody = new TextDecoder().decode(inputObj)
  } else if (typeof inputObj === "string") {
    rawBody = inputObj
  } else {
    rawBody = JSON.stringify((triggerEvent as any).body ?? triggerEvent)
  }

  let body: any = {}
  try {
    body = JSON.parse(rawBody)
  } catch (e) {
    body = rawBody
  }

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

  // --- 3. Confidential AI inference request (TEE) ---
  let resultStr = ""
  try {
    resultStr = assessAndClassify(runtime, walletProfile, req.encrypted_identity_blob)
  } catch (e) {
    runtime.log(`AI classification failed: ${String(e)}`)
    return JSON.stringify({ error: "ai_classification_failed", detail: String(e) })
  }

  return resultStr
}

// ---------------------------------------------------------------------------
// Workflow init
// ---------------------------------------------------------------------------

const initWorkflow = (config: Config) => {
  const http = new HTTPCapability()

  return [
    handler(
      http.trigger({ authorizedKeys: config.authorizedKeys }),
      onLoanApplication,
    ),
    handler(
      http.trigger({ authorizedKeys: config.authorizedKeys }),
      processInferenceCallback,
    ),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
