// Vercel serverless function → POST /api/world/decision. Polls CreditRegistry (Sepolia) for the CRE
// verdict; once it exists, writes it onto Vouch's seam (Arc setTerms) so the borrower can claim.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createDecisionHandler } from "../../server/verify.js";

const handler = createDecisionHandler(process.env as Record<string, string>);

export default function (req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
  }
  return (handler as unknown as (rq: unknown, rs: unknown) => void)(req, res);
}
