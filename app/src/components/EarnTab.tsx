import { useState } from "react";

/// Lender "Earn" surface (docs/01 tranche math, docs/06 Stage 7/8). Senior ~80% / ~6% fixed,
/// first-loss-protected; Junior ~20%, absorbs defaults first, takes residual interest (~26% in the
/// worked example). Cross-chain deposits arrive via Gateway / CCTP V2 (Stage 6) — architect
/// cross-chain, demo single-chain on Arc (Golden Rule #7). Wiring lands in Stage 8.
export function EarnTab() {
  const [tranche, setTranche] = useState<"senior" | "junior">("senior");
  const [amount, setAmount] = useState("");

  return (
    <section className="card">
      <h2>Earn — fund the pool</h2>
      <div className="tranche-toggle">
        <button
          className={tranche === "senior" ? "tab tab--active" : "tab"}
          onClick={() => setTranche("senior")}
        >
          Senior · ~6% APY · first-loss protected
        </button>
        <button
          className={tranche === "junior" ? "tab tab--active" : "tab"}
          onClick={() => setTranche("junior")}
        >
          Junior · ~26% APY · absorbs defaults first
        </button>
      </div>

      <label className="field">
        Deposit amount (USDC, 6 decimals)
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>

      <button className="btn btn--primary" disabled title="TranchePool wiring — Stage 8">
        Deposit to {tranche}
      </button>
      <p className="muted">
        Stage 8 wires TranchePool accounting + yield waterfall. Stage 6 adds any-chain deposits
        (Gateway / CCTP V2) settling into the Arc pool.
      </p>
    </section>
  );
}
