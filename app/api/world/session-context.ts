// Vercel serverless function → POST /api/world/session-context (mirrors the Vite dev middleware).
// Reuses the shared handler; Vercel's req/res are Node http-compatible, and readJson() in verify.ts
// handles Vercel's pre-parsed body. Secrets come from Vercel project env (WORLD_RP_SIGNING_KEY etc.).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSessionContextHandler } from "../../server/verify";

const handler = createSessionContextHandler(process.env as Record<string, string>);

export default function (req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
  }
  return (handler as unknown as (rq: unknown, rs: unknown) => void)(req, res);
}
