// Vercel serverless function → /api/market (mirrors the Vite dev middleware).
// GET reads the on-chain MarketRateEngine's live conditions + rates; POST advances the simulated
// global market one step and pushes it on-chain. Secrets (RELAYER_PRIVATE_KEY) come from Vercel env.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createMarketHandler } from "../server/marketEngine.js";

const handler = createMarketHandler(process.env as Record<string, string>);

export default function (req: VercelRequest, res: VercelResponse) {
  return (handler as unknown as (rq: unknown, rs: unknown) => void)(req, res);
}
