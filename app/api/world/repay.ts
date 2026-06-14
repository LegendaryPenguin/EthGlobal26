// Vercel serverless function → /api/world/repay. GET reads the on-chain amortization schedule;
// POST pays the next installment via the IncomeRouter (routes the slice back into the LoanVault pool).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createRepayHandler } from "../../server/repay.js";

const handler = createRepayHandler(process.env as Record<string, string>);

export default function (req: VercelRequest, res: VercelResponse) {
  return (handler as unknown as (rq: unknown, rs: unknown) => void)(req, res);
}
