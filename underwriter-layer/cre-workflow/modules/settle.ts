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
import type { Config, InferenceCallback } from "../types"
import { creditDecisionSchema } from "../types"
import { decodeHttpBody } from "./http"
import { deriveIntegrityTag } from "./integrity"

const REPORT_ABI = "address borrower, bool approved, string principal, string tranche, string riskBand, string denialReason, bytes32 transcriptHash, string inferenceId"

/**
 * Handles the async callback from the Confidential AI endpoint.
 *
 * Security layers:
 *  1. Integrity — re-fetches the inference from GET /v1/inference/:id with our
 *     API key and requires the callback's output to match the API's output.
 *  2. Decision — parses & schema-validates the AI's JSON from the VERIFIED output.
 *  3. Authenticity — re-derives the integrity tag from WORKFLOW_HMAC_SECRET and
 *     requires it to match the tag embedded in the verified prompt, proving the
 *     inference was authored by this workflow (not self-submitted by an attacker).
 *  4. Settlement — ABI-encodes and writes on-chain only after all checks pass.
 */
export function processInferenceCallback(
  runtime: Runtime<Config>,
  triggerEvent: HTTPPayload,
): string {
  const callback = JSON.parse(decodeHttpBody(triggerEvent)) as InferenceCallback

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

  const verifyCallback = (sendRequester: any): { verified: boolean; output: string; prompt: string; responseDigest: string } => {
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
      // Enclave-produced digest taken from the VERIFIED API response, not the
      // untrusted callback body.
      responseDigest: verifiedJson.resources?.[0]?.response_digest ?? "",
    }
  }

  const verifyAggregation = {
    method: "byFields",
    fields: {
      verified: { method: "identical" },
      output: { method: "identical" },
      prompt: { method: "identical" },
      responseDigest: { method: "identical" },
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

  // The model nulls these out on denial; the on-chain report needs strings.
  const principal = decision.principal ?? ""
  const tranche = decision.tranche ?? ""
  const riskBand = decision.riskBand ?? ""
  // Denial reason is only meaningful for rejections; force it empty when approved.
  const denialReason = decision.approved ? "" : (decision.denialReason ?? "")

  runtime.log(`Decision: approved=${decision.approved}, riskBand=${riskBand}, principal=${principal}`)

  // -----------------------------------------------------------------------
  // Compute transcript hash for on-chain verifiability
  // -----------------------------------------------------------------------
  // Derived entirely from VERIFIED data: prefer the enclave's response digest
  // returned by the API, falling back to a SHA-256 of the verified output.
  const transcriptHash = verified.responseDigest
    ? (`0x${verified.responseDigest.replace(/^0[xX]/, "").toLowerCase()}` as `0x${string}`)
    : sha256(stringToHex(verified.output))

  const inferenceId = callback.id

  // -----------------------------------------------------------------------
  // Extract borrower wallet from the verified prompt (fail closed)
  // -----------------------------------------------------------------------
  // The prompt is fetched from the attester API, so it is a trustworthy source
  // for the borrower address. If we cannot resolve it, we refuse to write
  // rather than attributing the decision to a fallback address.
  const borrowerMatch = verified.prompt.match(/Borrower wallet: (0x[a-fA-F0-9]{40})/)
  if (!borrowerMatch) {
    throw new Error("Could not resolve borrower from verified prompt — refusing to settle")
  }
  const borrower = getAddress(borrowerMatch[1] as `0x${string}`)

  // -----------------------------------------------------------------------
  // Layer 3: Workflow authenticity — verify the integrity tag
  // -----------------------------------------------------------------------
  // The verified prompt carries a tag = sha256(secret | borrower). An attacker
  // who self-submitted an inference with their own API key cannot forge this
  // tag without WORKFLOW_HMAC_SECRET, so a passing check proves the prompt was
  // authored by THIS workflow — not merely that some completed inference exists.
  const hmacSecretObj = runtime.getSecret({ id: "WORKFLOW_HMAC_SECRET" } as any).result()
  const hmacSecret = (hmacSecretObj as any).value || hmacSecretObj
  if (!hmacSecret) throw new Error("WORKFLOW_HMAC_SECRET secret not found for verification")

  const expectedTag = deriveIntegrityTag(hmacSecret, borrower)
  const tagMatch = verified.prompt.match(/Workflow integrity tag: (0x[a-fA-F0-9]{64})/)
  if (!tagMatch || tagMatch[1].toLowerCase() !== expectedTag.toLowerCase()) {
    throw new Error("Integrity tag mismatch — inference was not authored by this workflow")
  }

  runtime.log(`Borrower resolved and integrity tag verified: ${borrower}`)

  // -----------------------------------------------------------------------
  // Layer 4: ABI-encode and write on-chain
  // -----------------------------------------------------------------------

  const encodedPayload = encodeAbiParameters(parseAbiParameters(REPORT_ABI), [
    borrower,
    decision.approved,
    principal,
    tranche,
    riskBand,
    denialReason,
    transcriptHash,
    inferenceId,
  ])

  const receiver = runtime.config.consumerAddress
  const receiverIsUnset = /^0x0{40}$/i.test(receiver)
  if (receiverIsUnset) {
    runtime.log(
      "WARNING: consumerAddress is the zero address — the report will be delivered to a " +
        "no-op receiver and NOT stored in any CreditRegistry. Set consumerAddress to a deployed registry.",
    )
  }

  let write: any = { attempted: false }
  try {
    const signedReport = runtime.report(prepareReportRequest(encodedPayload)).result()

    const selectors = EVMClient.SUPPORTED_CHAIN_SELECTORS
    const chainSelector = selectors[runtime.config.chainSelectorName as keyof typeof selectors]

    // @ts-ignore
    const reply = new EVMClient(chainSelector)
      .writeReport(runtime, {
        receiver,
        report: signedReport,
        gasConfig: { gasLimit: "500000" },
      })
      .result()

    const txHash = reply.txHash ? toHex(reply.txHash) : null
    write = { txHash, receiver, storedInRegistry: !receiverIsUnset }
    runtime.log(
      receiverIsUnset
        ? `Report submitted to forwarder (txHash=${txHash}) but receiver is unset — not persisted.`
        : `On-chain write delivered to registry ${receiver}: txHash=${txHash}`,
    )
  } catch (err) {
    write = { attempted: true, error: String(err) }
    runtime.log(`On-chain write failed: ${write.error}`)
  }

  return JSON.stringify({
    id: callback.id,
    approved: decision.approved,
    denialReason: decision.approved ? null : (denialReason || null),
    transcriptHash,
    write
  })
}
