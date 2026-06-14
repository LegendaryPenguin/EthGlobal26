import {
  HTTPClient,
  type Runtime,
} from "@chainlink/cre-sdk"
import type { Config, WalletProfile } from "../types"
import { SYSTEM_PROMPT, buildClassificationPrompt } from "../prompts"
import { deriveIntegrityTag } from "./integrity"

export function assessAndClassify(
  runtime: Runtime<Config>,
  profile: WalletProfile,
  encryptedIdentityBlob: string,
  borrowerWallet: string,
  requestedPrincipal: string
): string {
  const apiKeySecret = runtime.getSecret({ id: "CONF_AI_API_KEY" } as any)
  const apiKeyObj = apiKeySecret.result()
  const apiKey = (apiKeyObj as any).value || apiKeyObj
  if (!apiKey) throw new Error("CONF_AI_API_KEY secret not found")

  // Workflow-held secret used to bind the prompt to THIS workflow (see integrity.ts).
  const hmacSecretObj = runtime.getSecret({ id: "WORKFLOW_HMAC_SECRET" } as any).result()
  const hmacSecret = (hmacSecretObj as any).value || hmacSecretObj
  if (!hmacSecret) throw new Error("WORKFLOW_HMAC_SECRET secret not found")
  const integrityTag = deriveIntegrityTag(hmacSecret, borrowerWallet)

  const baseUrl = runtime.config.confAiBaseUrl
  const httpClient = new HTTPClient()

  const callAttester = (sendRequester: any): { id: string, status: string } => {
    // Submit inference
    const submitReqStr = JSON.stringify({
      model: runtime.config.confAiModel,
      system_prompt: SYSTEM_PROMPT,
      prompt: buildClassificationPrompt(profile, encryptedIdentityBlob, borrowerWallet, requestedPrincipal, integrityTag),
      cre_callback: { url: runtime.config.creCallbackUrl }
    })
    
    const submitBody = new TextEncoder().encode(submitReqStr)

    const submitResp = sendRequester.sendRequest({
      url: `${baseUrl}/v1/inference`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: submitBody,
    }).result()

    if (submitResp.statusCode >= 400) {
      throw new Error(`Attester submit failed: HTTP ${submitResp.statusCode}`)
    }

    const jsonStr = new TextDecoder().decode(submitResp.body)
    const json = JSON.parse(jsonStr)
    const requestId = (json as any).id
    if (!requestId) throw new Error("Attester returned no request ID")

    return { id: requestId, status: json.status || "queued" }
  }

  const aggregation = {
    method: "byFields",
    fields: { 
      id: { method: "identical" },
      status: { method: "identical" }
    },
  } as any

  const result = httpClient.sendRequest(runtime, callAttester, aggregation)().result()

  runtime.log(`Inference queued with ID: ${result.id}`)
  return JSON.stringify(result)
}
