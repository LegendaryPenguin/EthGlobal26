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
import { decodeHttpBody } from "./modules/http"

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
  const rawBody = decodeHttpBody(triggerEvent)

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
    resultStr = assessAndClassify(runtime, walletProfile, req.encrypted_identity_blob, req.borrower_wallet, req.requested_principal)
  } catch (e) {
    runtime.log(`AI classification failed: ${String(e)}`)
    return JSON.stringify({ error: "ai_classification_failed", detail: String(e) })
  }

  return resultStr
}

// ---------------------------------------------------------------------------
// Unified HTTP Router
// ---------------------------------------------------------------------------
// The Chainlink CRE exposes a single webhook URL per workflow.
// We route incoming HTTP requests based on their payload structure.

const unifiedHttpRouter = (
  runtime: Runtime<Config>,
  triggerEvent: HTTPPayload,
): string => {
  const rawBody = decodeHttpBody(triggerEvent)

  let body: any = {}
  try {
    body = JSON.parse(rawBody)
  } catch (e) {
    body = rawBody
  }

  runtime.log(`Raw Body typeof: ${typeof rawBody}, value: ${rawBody.substring(0, 200)}`)

  // Sometimes HTTP triggers parse the JSON body automatically into `triggerEvent.body`
  const actualBody = (triggerEvent as any).body ? (typeof (triggerEvent as any).body === 'string' ? JSON.parse((triggerEvent as any).body) : (triggerEvent as any).body) : body;
  const payloadToRoute = actualBody.input ? actualBody.input : actualBody;
  
  runtime.log(`Payload keys: ${Object.keys(payloadToRoute).join(', ')}`)

  if (payloadToRoute.borrower_wallet) {
    // It's a Loan Application
    return onLoanApplication(runtime, triggerEvent)
  } else if (payloadToRoute.id && payloadToRoute.status) {
    // It's an AI Inference Callback
    return processInferenceCallback(runtime, triggerEvent)
  } else {
    runtime.log(`Unknown payload format received`)
    return JSON.stringify({ error: "unknown_payload_format" })
  }
}

// ---------------------------------------------------------------------------
// Workflow init
// ---------------------------------------------------------------------------

const initWorkflow = (config: Config) => {
  const http = new HTTPCapability()

  return [
    handler(
      http.trigger({ authorizedKeys: config.authorizedKeys }),
      unifiedHttpRouter,
    )
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
