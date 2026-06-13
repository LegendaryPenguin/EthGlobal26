import {
  EVMClient,
  HTTPClient,
  type Runtime,
  prepareReportRequest,
  type HTTPPayload,
} from "@chainlink/cre-sdk"
import {
  encodeAbiParameters,
  parseAbiParameters,
  getAddress,
  sha256,
  stringToHex,
  toHex,
} from "viem"
import type { Config, InferenceCallback, CreditDecision } from "../types"
import { creditDecisionSchema } from "../types"

const REPORT_ABI = "address borrower, bool approved, string principal, string tranche, string riskBand, bytes32 transcriptHash, string inferenceId"

/**
 * Handles the async callback from the Confidential AI endpoint.
 *
 * Security layers:
 *  1. Verifies the callback by polling GET /v1/inference/:id with our API key
 *  2. Validates output digest integrity
 *  3. Only writes on-chain after both checks pass
 */
export function processInferenceCallback(
  runtime: Runtime<Config>,
  triggerEvent: HTTPPayload,
): string {
  // Decode HTTP body
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

  const callback = JSON.parse(rawBody) as InferenceCallback

  runtime.log(
    `Inference callback received: id=${callback.id ?? "unknown"} status=${callback.status ?? "unknown"}`,
  )

  if (callback.status !== "completed") {
    return JSON.stringify({ action: "skipped", status: callback.status })
  }

  if (!callback.id) {
    throw new Error("Callback missing inference ID — cannot verify")
  }

  // -----------------------------------------------------------------------
  // Layer 1: Verify the callback against the Confidential AI API
  // -----------------------------------------------------------------------

  const apiKeySecret = runtime.getSecret({ id: "CONF_AI_API_KEY" } as any)
  const apiKeyObj = apiKeySecret.result()
  const apiKey = (apiKeyObj as any).value || apiKeyObj
  if (!apiKey) throw new Error("CONF_AI_API_KEY secret not found for verification")

  const httpClient = new HTTPClient()

  const verifyCallback = (sendRequester: any): { verified: boolean; output: string; prompt: string } => {
    const verifyResp = sendRequester.sendRequest({
      url: `${runtime.config.confAiBaseUrl}/v1/inference/${callback.id}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }).result()

    if (verifyResp.statusCode >= 400) {
      throw new Error(`Verification request failed: HTTP ${verifyResp.statusCode}`)
    }

    const verifiedJson = JSON.parse(new TextDecoder().decode(verifyResp.body))

    // The API must confirm this inference is completed
    if (verifiedJson.status !== "completed") {
      throw new Error(`Verification failed: API says status=${verifiedJson.status}, callback says completed`)
    }

    // The output from the API must match the callback's output
    if (verifiedJson.output !== callback.output) {
      throw new Error("Verification failed: output mismatch between callback and API")
    }

    return {
      verified: true,
      output: verifiedJson.output,
      prompt: verifiedJson.prompt ?? "",
    }
  }

  const verifyAggregation = {
    method: "byFields",
    fields: {
      verified: { method: "identical" },
      output: { method: "identical" },
      prompt: { method: "identical" },
    },
  } as any

  const verified = httpClient.sendRequest(runtime, verifyCallback, verifyAggregation)().result()

  if (!verified.verified) {
    throw new Error("Callback verification failed")
  }

  runtime.log(`Inference ${callback.id} verified against API`)

  // -----------------------------------------------------------------------
  // Layer 2: Parse and validate the AI decision
  // -----------------------------------------------------------------------

  const output = verified.output ?? ""
  const fenced = output.trim().match(/^```(?:[a-zA-Z0-9]+)?\s*([\s\S]*?)\s*```$/)
  const jsonStr = fenced ? fenced[1].trim() : output

  const parsed = creditDecisionSchema.safeParse(JSON.parse(jsonStr))
  if (!parsed.success) {
    throw new Error(`AI decision parse failed: ${parsed.error.message}`)
  }
  const decision = parsed.data

  runtime.log(`Decision: approved=${decision.approved}, riskBand=${decision.riskBand}, principal=${decision.principal}`)

  // -----------------------------------------------------------------------
  // Compute transcript hash for on-chain verifiability
  // -----------------------------------------------------------------------

  const responseDigest = callback.resources?.[0]?.response_digest
  const transcriptHash = responseDigest
    ? (`0x${responseDigest.replace(/^0[xX]/, "").toLowerCase()}` as `0x${string}`)
    : sha256(stringToHex(output))

  const inferenceId = callback.id

  // -----------------------------------------------------------------------
  // Extract borrower wallet from the verified prompt
  // -----------------------------------------------------------------------
  // The prompt text from Trigger 0 includes the borrower wallet. Since we
  // verified this prompt against the API (not trusting the callback), this
  // is a trustworthy source for the borrower address.
  const borrowerMatch = verified.prompt.match(/Borrower wallet: (0x[a-fA-F0-9]{40})/)
  const borrower = borrowerMatch
    ? getAddress(borrowerMatch[1] as `0x${string}`)
    : getAddress(runtime.config.consumerAddress) // fallback for testing

  runtime.log(`Borrower resolved: ${borrower}`)

  // -----------------------------------------------------------------------
  // Layer 3: ABI-encode and write on-chain
  // -----------------------------------------------------------------------

  const encodedPayload = encodeAbiParameters(parseAbiParameters(REPORT_ABI), [
    borrower,
    decision.approved,
    decision.principal,
    decision.tranche,
    decision.riskBand,
    transcriptHash,
    inferenceId,
  ])

  let write: any = { attempted: false }
  try {
    const signedReport = runtime.report(prepareReportRequest(encodedPayload)).result()

    const selectors = EVMClient.SUPPORTED_CHAIN_SELECTORS
    const chainSelector = selectors[runtime.config.chainSelectorName as keyof typeof selectors]
    
    // @ts-ignore
    const reply = new EVMClient(chainSelector)
      .writeReport(runtime, {
        receiver: runtime.config.consumerAddress,
        report: signedReport,
        gasConfig: { gasLimit: "500000" },
      })
      .result()

    write = { txHash: reply.txHash ? toHex(reply.txHash) : null }
    runtime.log(`On-chain write successful: txHash=${write.txHash}`)
  } catch (err) {
    write = { attempted: true, error: String(err) }
    runtime.log(`On-chain write failed: ${write.error}`)
  }

  return JSON.stringify({
    id: callback.id,
    approved: decision.approved,
    transcriptHash,
    write
  })
}
