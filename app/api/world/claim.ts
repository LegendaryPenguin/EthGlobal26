// Vercel serverless function → POST /api/world/claim. Funds the human's managed wallet for gas and
// signs LoanVault.claim() on their behalf.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClaimHandler } from "../../server/verify.js";

const handler = createClaimHandler(process.env as Record<string, string>);

export default function (req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
  }
  return (handler as unknown as (rq: unknown, rs: unknown) => void)(req, res);
}
