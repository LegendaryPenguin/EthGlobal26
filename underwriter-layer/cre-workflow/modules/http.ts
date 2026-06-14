import type { HTTPPayload } from "@chainlink/cre-sdk"

/**
 * Decodes the raw HTTP request body from a CRE HTTP trigger event.
 *
 * CRE delivers the body in a few shapes depending on transport, so we
 * normalize them all to a UTF-8 string here instead of duplicating the
 * branching at every call site.
 */
export function decodeHttpBody(triggerEvent: HTTPPayload): string {
  const inputObj = (triggerEvent as any).input
  if (inputObj && Array.isArray(inputObj.data)) {
    return new TextDecoder().decode(new Uint8Array(inputObj.data))
  }
  if (inputObj instanceof Uint8Array) {
    return new TextDecoder().decode(inputObj)
  }
  if (typeof inputObj === "string") {
    return inputObj
  }
  return JSON.stringify((triggerEvent as any).body ?? triggerEvent)
}
