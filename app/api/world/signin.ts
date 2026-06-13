// Vercel serverless function → POST /api/world/signin. Verifies the World ID session proof, provisions
// the human's managed wallet, mints/loads the passport, runs the underwriter, and writes terms.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSigninHandler } from "../../server/verify.js";

const handler = createSigninHandler(process.env as Record<string, string>);

export default function (req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
  }
  return (handler as unknown as (rq: unknown, rs: unknown) => void)(req, res);
}
