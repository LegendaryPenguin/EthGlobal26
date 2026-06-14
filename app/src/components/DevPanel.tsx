import { useState, useSyncExternalStore } from "react";
import { subscribeDevlog, getDevlog, type DevEvent } from "../devlog";

const KIND_DOT: Record<DevEvent["kind"], string> = {
  tx: "dp-dot--tx", proof: "dp-dot--proof", id: "dp-dot--id", info: "dp-dot--info", error: "dp-dot--err",
};
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
const short = (v: string) => (v.length > 18 ? `${v.slice(0, 10)}…${v.slice(-6)}` : v);

/// Live activity feed — every on-chain tx + ZK/CRE proof as it happens, timestamped, with explorer
/// links. The judge-facing "this is real" panel. Collapsible; lives fixed on the right.
export function DevPanel() {
  const events = useSyncExternalStore(subscribeDevlog, getDevlog, getDevlog);
  const [open, setOpen] = useState(true);

  return (
    <>
      <button className="dp-toggle" onClick={() => setOpen((o) => !o)} aria-label="Toggle dev panel">
        {open ? "›" : "‹"} <span>live proof feed</span>
        {events.length > 0 && <span className="dp-count">{events.length}</span>}
      </button>
      {open && (
        <aside className="dp">
          <div className="dp-head">
            <strong>Live proof feed</strong>
            <span className="muted">on-chain txs + ZK/CRE proofs, as they happen</span>
          </div>
          <div className="dp-body">
            {events.length === 0 ? (
              <p className="muted dp-empty">Nothing yet — start the borrow flow and watch it fill in real time.</p>
            ) : (
              events.map((e) => (
                <div key={e.id} className="dp-row">
                  <span className={`dp-dot ${KIND_DOT[e.kind]}`} />
                  <div className="dp-row-main">
                    <div className="dp-row-top">
                      <span className="dp-label">{e.label}</span>
                      <span className="dp-time">{time(e.t)}</span>
                    </div>
                    {e.value && (
                      e.link ? (
                        <a className="dp-val dp-val--link" href={e.link} target="_blank" rel="noreferrer">
                          {short(e.value)} ↗
                        </a>
                      ) : (
                        <code className="dp-val">{short(e.value)}</code>
                      )
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </>
  );
}
