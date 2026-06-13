import { useStore } from "../store";
import { CheckCircle } from "../components/Icons";

// Activity tab — logs the deposit legs. Real (Arc) legs show a green check + Arcscan link;
// simulated (cross-chain / not-connected) legs are clearly labelled "Simulated". DESIGN_SPEC §5.
export function Activity() {
  const { state } = useStore();
  return (
    <div>
      <h1 className="t-heading-md page-title">Activity</h1>
      {state.activity.length === 0 ? (
        <div className="empty t-body-md text-alt">No transactions yet. Your deposit legs will appear here.</div>
      ) : (
        <div className="activity-list">
          {state.activity.map((leg) => (
            <div className="activity-row" key={leg.id}>
              <span className="activity-row__icon">
                {leg.sim ? <span className="sim-dot" /> : <CheckCircle size={22} />}
              </span>
              <span className="activity-row__meta">
                <span className="t-body-md-bold">{leg.title}</span>
                <span className="t-body-sm text-alt">{leg.sub}</span>
                {leg.href && (
                  <a className="t-body-sm activity-row__link" href={leg.href} target="_blank" rel="noreferrer">
                    View on Arcscan ↗
                  </a>
                )}
              </span>
              <span className={`t-body-sm-medium ${leg.sim ? "text-muted" : "text-success"}`}>
                {leg.sim ? "Simulated" : "Confirmed"}
              </span>
            </div>
          ))}
        </div>
      )}
      {state.activity.some((l) => l.sim) && (
        <p className="t-body-xs text-muted" style={{ marginTop: 16 }}>
          "Simulated" legs are demo-only (cross-chain bridge + non-connected flow). Connect MetaMask and deposit USDC
          already on Arc for real, on-chain transactions with Arcscan links.
        </p>
      )}
    </div>
  );
}
