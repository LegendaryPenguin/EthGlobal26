import { useState, useEffect, useCallback } from "react";
import { logEvent, arcTx } from "../devlog";
import { USD_PER_USDC } from "./ApplicationWizard";

type Installment = { index: number; amountUsdc: string; dueAt: number; paid: boolean };
type Schedule = {
  ok: boolean; hasLoan?: boolean; repaid?: boolean; repayTx?: string;
  outstandingUsdc?: string; totalRepayableUsdc?: string; aprBps?: number;
  installments?: Installment[];
};

const usdcNum = (s?: string) => (s ? Number(s) / 1e6 : 0);
const fmt = (usdc: number) => `$${(usdc * USD_PER_USDC).toLocaleString(undefined, { maximumFractionDigits: 0 })} (${usdc} USDC)`;
const dueLabel = (sec: number) => {
  const d = new Date(sec * 1000);
  const days = Math.round((sec * 1000 - Date.now()) / 86_400_000);
  return `${d.toLocaleDateString()} · ${days <= 0 ? "due now" : `in ${days}d`}`;
};

/// Repayments tab — appears once a loan is disbursed. Reads the on-chain amortization schedule
/// (4 installments, staggered deadlines, interest-bearing) and pays each one through the IncomeRouter,
/// routing the USDC back into the LoanVault pool (the lenders' capital) on Arc. One-by-one.
export function RepaymentsPanel({ sessionNullifier }: { sessionNullifier: string }) {
  const [s, setS] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (pay: boolean) => {
    setBusy(true);
    try {
      const r = (await (await fetch(`/api/world/repay${pay ? "" : `?sessionNullifier=${encodeURIComponent(sessionNullifier)}`}`, {
        method: pay ? "POST" : "GET",
        headers: pay ? { "Content-Type": "application/json" } : undefined,
        body: pay ? JSON.stringify({ sessionNullifier }) : undefined,
      })).json()) as Schedule;
      if (r.repayTx) logEvent({ kind: "tx", label: "Loan installment repaid on Arc (→ pool)", value: r.repayTx, link: arcTx(r.repayTx) });
      setS(r);
    } catch { /* ignore */ } finally { setBusy(false); }
  }, [sessionNullifier]);

  useEffect(() => { void load(false); }, [load]);

  if (!s || !s.hasLoan || !s.installments) return null;

  const outstanding = usdcNum(s.outstandingUsdc);
  const total = usdcNum(s.totalRepayableUsdc);
  const nextUnpaid = s.installments.find((i) => !i.paid);

  return (
    <div className="passport-card" style={{ marginTop: 16 }}>
      <strong>📆 Repayments</strong>
      <p className="muted" style={{ marginTop: 4, marginBottom: 8 }}>
        {s.repaid
          ? "Fully repaid — capital returned to the lender pool. ✓"
          : `Owed: ${fmt(outstanding)} of ${fmt(total)} · ${s.aprBps ? (s.aprBps / 100).toFixed(2) + "% APR" : ""}. Each payment routes back into the lender pool on Arc.`}
      </p>
      <ul className="credit-report" style={{ listStyle: "none", padding: 0 }}>
        {s.installments.map((inst) => (
          <li key={inst.index} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--hair,#eee)" }}>
            <span>
              <strong>#{inst.index + 1}</strong>{" "}
              <span className="muted">{fmt(usdcNum(inst.amountUsdc))}</span>{" "}
              <span className="muted" style={{ fontSize: 12 }}>· {dueLabel(inst.dueAt)}</span>
            </span>
            {inst.paid ? (
              <span className="zk-verdict zk-verdict--ok" style={{ margin: 0 }}>paid ✓</span>
            ) : inst.index === nextUnpaid?.index ? (
              <button className="btn btn--primary" onClick={() => void load(true)} disabled={busy}>
                {busy ? "Paying…" : "Pay"}
              </button>
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>upcoming</span>
            )}
          </li>
        ))}
      </ul>
      {s.repayTx && (
        <p className="muted" style={{ marginTop: 6 }}>
          Last payment on Arc: <a className="tlink" href={arcTx(s.repayTx)} target="_blank" rel="noreferrer"><code>{s.repayTx.slice(0, 10)}…</code> ↗</a>
        </p>
      )}
    </div>
  );
}
