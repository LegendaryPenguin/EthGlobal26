import {
  HTTPClientCapability,
  type Runtime,
  type ConsensusAggregationByFields,
} from "@chainlink/cre-sdk"
import type { Config, WalletProfile, CreditDecision } from "../types"
import { creditDecisionSchema } from "../types"
import { SYSTEM_PROMPT, buildClassificationPrompt } from "../prompts"

type InferenceResult = { decision: string }

/**
 * Sends the wallet profile to the Chainlink Confidential AI Attester for
 * risk classification inside a TEE. The association between the human
 * identity (World ID) and their wallets never leaves the enclave —
 * only the anonymized lending decision comes out.
 *
 * Uses runInNodeMode so each DON node independently calls the Attester API
 * with the secret API key, then results are aggregated via consensus.
 */
export function assessAndClassify(
  runtime: Runtime<Config>,
  profile: WalletProfile,
): CreditDecision {
  const httpClient = new HTTPClientCapability()

  const callAttester = (): InferenceResult => {
    const apiKey = runtime.getSecret("CONF_AI_API_KEY")
    if (!apiKey) throw new Error("CONF_AI_API_KEY secret not found")

    const baseUrl = runtime.config.confAiBaseUrl

    // Submit inference — no document uploads, just structured wallet data
    const submitResp = fetch(`${baseUrl}/v1/inference`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: runtime.config.confAiModel,
        system_prompt: SYSTEM_PROMPT,
        prompt: buildClassificationPrompt(profile),
      }),
    })

    if (!submitResp.ok) {
      throw new Error(`Attester submit failed: HTTP ${submitResp.status}`)
    }

    const { id: requestId } = submitResp.json() as { id: string }
    if (!requestId) throw new Error("Attester returned no request ID")

    // Poll until completed or failed (max ~3 min)
    const MAX_POLLS = 60
    for (let i = 0; i < MAX_POLLS; i++) {
      const pollResp = fetch(`${baseUrl}/v1/inference/${requestId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })

      if (!pollResp.ok) {
        throw new Error(`Attester poll failed: HTTP ${pollResp.status}`)
      }

      const pollData = pollResp.json() as {
        status: string
        output?: string
        error?: string
      }

      if (pollData.status === "completed") {
        return { decision: pollData.output ?? "" }
      }

      if (pollData.status === "failed") {
        throw new Error(`Inference failed: ${pollData.error ?? "unknown"}`)
      }
    }

    throw new Error("Attester inference timed out after polling")
  }

  const aggregation: ConsensusAggregationByFields<InferenceResult> = {
    method: "byFields",
    fields: { decision: { method: "identical" } },
  }

  const result = httpClient
    .runInNodeMode(runtime, callAttester, aggregation)()
    .result()

  runtime.log(`AI raw output: ${result.decision}`)

  // Parse and validate the AI decision
  const parsed = creditDecisionSchema.safeParse(JSON.parse(result.decision))
  if (!parsed.success) {
    throw new Error(`AI decision parse failed: ${parsed.error.message}`)
  }

  runtime.log(
    `Decision: approved=${String(parsed.data.approved)}, ` +
      `principal=${parsed.data.principal}, ` +
      `tranche=${parsed.data.tranche}, ` +
      `riskBand=${parsed.data.riskBand}`,
  )

  return parsed.data
}
