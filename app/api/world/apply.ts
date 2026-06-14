// Vercel serverless function → POST /api/world/apply. Submits the loan application to the Chainlink
// CRE / Confidential AI (/trigger) and returns the inference id to poll.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createApplyHandler } from "../../server/verify.js";

const handler = createApplyHandler(process.env as Record<string, string>);

export default function (req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
  }
  return (handler as unknown as (rq: unknown, rs: unknown) => void)(req, res);
}
