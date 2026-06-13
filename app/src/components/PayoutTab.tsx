import { useState } from "react";

/// Mock creator-payout dashboard (docs/06 Stage 7). The "Cash out" button is demo money-shot #3:
/// it really calls IncomeRouter.onPayout, which splits the payout — repayment slice → LoanVault,
/// remainder → borrower. Wiring lands with IncomeRouter in Stage 2/7. USDC = 6 decimals.
export function PayoutTab() {
  const [payout, setPayout] = useState("900");

  return (
    <section className="card">
      <h2>Creator payout (mock)</h2>
      <p className="muted">
        Simulates Tunde's platform paying out. "Cash out" calls <code>IncomeRouter.onPayout</code>{" "}
        and auto-routes the repayment slice to the loan before the rest reaches the borrower.
      </p>

      <label className="field">
        Incoming payout (USDC)
        <input
          inputMode="decimal"
          value={payout}
          onChange={(e) => setPayout(e.target.value)}
        />
      </label>

      <button className="btn btn--primary" disabled title="IncomeRouter wiring — Stage 2/7">
        Cash out
      </button>
      <p className="muted">
        Stage 2 implements the split (schedule-driven); Stage 7 wires this button to the live
        contract so the demo shows the slice → loan, remainder → borrower in real time.
      </p>
    </section>
  );
}
