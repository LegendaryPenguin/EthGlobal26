// Vercel serverless function → POST /api/world/link-wallet (mirrors the Vite dev middleware).
// Binds a connected wallet to the current World ID via the WalletLink contract on Arc (relayer = linker).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createLinkWalletHandler } from "../../server/walletLink.js";

const handler = createLinkWalletHandler(process.env as Record<string, string>);

export default function (req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
  }
  return (handler as unknown as (rq: unknown, rs: unknown) => void)(req, res);
}
