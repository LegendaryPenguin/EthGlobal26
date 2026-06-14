// Vercel serverless function → GET /api/attestation?id=<inferenceId>. Re-fetches the Confidential AI
// TEE inference and returns its attestation material (model, response_digest, verdict) so the UI can
// prove the on-chain attestationRef is bound to a real, re-queryable inference.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createAttestationHandler } from "../server/attestation.js";

const handler = createAttestationHandler(process.env as Record<string, string>);

export default function (req: VercelRequest, res: VercelResponse) {
  return (handler as unknown as (rq: unknown, rs: unknown) => void)(req, res);
}
