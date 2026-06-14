import { useEffect, useState, useCallback } from "react";
import { arcTx } from "../devlog";

type Market = {
  ok: boolean;
  engine: string;
  txHash?: string;
  conditions: { baseRateBps: number; willingLenders: number; willingBorrowers: number; suppliedUsdc: string; borrowedUsdc: string };
  rates: { borrowAprBps: number; supplyYieldBps: number; utilizationBps: number; lastPokeAt: number };
};

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const usdc = (raw: string) => `${(Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/// Live view of the on-chain MarketRateEngine on Arc (Track 1). Reads /api/market (GET); the
/// "Advance market" button POSTs, which random-walks global conditions and pushes them ON-CHAIN
/// (a real tx) so judges can watch the borrow APR + lender yield move from the formula.
export function MarketPanel() {
  const [m, setM] = useState<Market | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const load = useCallback(async (advance: boolean) => {
    setBusy(true); setErr(undefined);
    try {
      const r = (await (await fetch("/api/market", { method: advance ? "POST" : "GET" })).json()) as Market;
      if (!r.ok) throw new Error("market unavailable");
      setM(r);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  if (!m && !err) return <div className="passport-card"><span className="muted">Loading live Arc market…</span></div>;
  if (err && !m) return <div className="passport-card"><span className="muted">Market: {err}</span></div>;
  if (!m) return null;

  const c = m.conditions, r = m.rates;
  return (
    <div className="passport-card" style={{ marginTop: 16 }}>
      <strong>📈 Live market on Arc</strong>
      <p className="muted" style={{ marginTop: 4, marginBottom: 10 }}>
        Rates computed <em>on-chain</em> by the MarketRateEngine from utilization + supply/demand + global conditions.
      </p>
      <div className="zk-split">
        <div className="zk-col zk-col--public">
          <div className="zk-col__head">Borrower</div>
          <ul className="zk-list">
            <li>Borrow APR: <strong>{pct(r.borrowAprBps)}</strong></li>
            <li>Utilization: <strong>{pct(r.utilizationBps)}</strong></li>
            <li>Base rate: <code>{pct(c.baseRateBps)}</code></li>
          </ul>
        </div>
        <div className="zk-col zk-col--private">
          <div className="zk-col__head">Lender</div>
          <ul className="zk-list">
            <li>Expected yield: <strong>{pct(r.supplyYieldBps)}</strong></li>
            <li>Willing lenders: <strong>{c.willingLenders}</strong></li>
            <li>Willing borrowers: <strong>{c.willingBorrowers}</strong></li>
          </ul>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Pool (global): <strong>{usdc(c.suppliedUsdc)}</strong> supplied · <strong>{usdc(c.borrowedUsdc)}</strong> borrowed
      </p>
      <div className="zk-actions" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => void load(true)} disabled={busy}>
          {busy ? "Advancing…" : "Advance market (on-chain)"}
        </button>
      </div>
      {m.txHash && (
        <p className="muted" style={{ marginTop: 6 }}>
          Pushed on-chain: <a className="tlink" href={arcTx(m.txHash)} target="_blank" rel="noreferrer"><code>{m.txHash.slice(0, 10)}…</code> ↗</a>
        </p>
      )}
    </div>
  );
}
