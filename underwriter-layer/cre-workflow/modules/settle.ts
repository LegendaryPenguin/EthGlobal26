import {
  EVMClient,
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

const REPORT_ABI = "address borrower, bool approved, string reason, bytes32 transcriptHash, string inferenceId"

/**
 * Handles the async callback from the Confidential AI endpoint.
 * Once the AI TEE is done analyzing the JSON, it POSTs the result
 * to this handler, which verifies it and writes it on-chain.
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

  // Extract fenced JSON
  const output = callback.output ?? ""
  const fenced = output.trim().match(/^```(?:[a-zA-Z0-9]+)?\s*([\s\S]*?)\s*```$/)
  const jsonStr = fenced ? fenced[1].trim() : output

  const parsed = creditDecisionSchema.safeParse(JSON.parse(jsonStr))
  if (!parsed.success) {
    throw new Error(`AI decision parse failed: ${parsed.error.message}`)
  }
  const decision = parsed.data

  runtime.log(`Decision: approved=${decision.approved}, riskBand=${decision.riskBand}`)

  const responseDigest = callback.resources?.[0]?.response_digest
  const transcriptHash = responseDigest
    ? (`0x${responseDigest.replace(/^0[xX]/, "").toLowerCase()}` as `0x${string}`)
    : sha256(stringToHex(output))

  const inferenceId = callback.id ?? ""

  // Use a standard borrower address for now (must match consumer gate expectations)
  const borrower = getAddress(runtime.config.usdcAddress) // Fallback for simulation
  
  const encodedPayload = encodeAbiParameters(parseAbiParameters(REPORT_ABI), [
    borrower,
    decision.approved,
    decision.riskBand, // Use riskBand as reason
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
