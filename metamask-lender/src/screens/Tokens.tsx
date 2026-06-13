import { useStore, fmt } from "../store";
import { PORTFOLIO_ROWS, TOKENS, TRANCHES, type ChainId } from "../data/mock";
import { Button, Pill } from "../components/ui";
import { TokenIcon, ChainIcon, Chevron } from "../components/Icons";
import { VouchMark } from "../components/VouchMark";

// Stacked multi-network badge cluster for an aggregated token row.
function NetworkStack({ chains }: { chains: ChainId[] }) {
  return (
    <span className="netstack">
      {chains.slice(0, 3).map((c, i) => (
        <span key={c} style={{ marginLeft: i === 0 ? 0 : -6, zIndex: 3 - i }}>
          <ChainIcon chain={c} size={16} />
        </span>
      ))}
    </span>
  );
}

// Screen 1 — Portfolio home / Tokens. DESIGN_SPEC §5.
export function Tokens() {
  const { state, dispatch } = useStore();
  const total = 8260 + (state.position ? state.position.principal : 0);

  return (
    <div>
      <h1 className="t-heading-md page-title">Tokens</h1>
      <div className="balance-hero">
        <span className="t-heading-lg tabular">${fmt(total)}</span>
        <span className="t-body-sm text-success">+$31.20 (0.4%) today</span>
      </div>

      {/* Earn nudge */}
      {!state.position && (
        <div className="nudge">
          <span className="nudge__icon"><VouchMark size={40} /></span>
          <div className="nudge__text">
            <div className="t-body-md-bold">Put idle USDC to work</div>
            <div className="t-body-sm text-alt">Earn up to 26% APY on your USDC.</div>
          </div>
          <Button onClick={() => dispatch({ type: "tab", tab: "stake" })}>Explore Earn</Button>
        </div>
      )}

      <div className="tokenlist">
        {/* Active Vouch position appears as a first-class row */}
        {state.position && (
          <button
            className="token-row token-row--position"
            onClick={() => {
              dispatch({ type: "tab", tab: "stake" });
              dispatch({ type: "step", step: "success" });
            }}
          >
            <span className="token-row__l">
              <VouchMark size={36} />
              <span className="token-row__meta">
                <span className="t-body-md">Vouch — {TRANCHES[state.position.tranche].name}</span>
                <span className="t-body-sm text-alt">Earning · {TRANCHES[state.position.tranche].apyLabel}</span>
              </span>
            </span>
            <span className="token-row__r">
              <span className="token-row__rmeta">
                <span className="t-body-md-bold tabular">${fmt(state.position.principal)}</span>
                <Pill tone="neutral">Earning</Pill>
              </span>
              <Chevron dir="right" size={16} color="var(--color-text-muted)" />
            </span>
          </button>
        )}

        {PORTFOLIO_ROWS.map((r) => (
          <div className="token-row" key={r.token}>
            <span className="token-row__l">
              <span style={{ position: "relative", display: "inline-flex" }}>
                <TokenIcon symbol={r.token} size={36} />
                <span style={{ position: "absolute", right: -3, bottom: -3 }}>
                  <ChainIcon chain={r.networks[0]} size={16} />
                </span>
              </span>
              <span className="token-row__meta">
                <span className="t-body-md">{TOKENS[r.token].name}</span>
                <span className="token-row__sub">
                  <span className="t-body-sm text-alt tabular">{r.price}</span>
                  <span className={`t-body-sm ${r.up ? "text-success" : "text-error"}`}>{r.change}</span>
                  {r.networks.length > 1 && <NetworkStack chains={r.networks} />}
                </span>
              </span>
            </span>
            <span className="token-row__r">
              <span className="token-row__rmeta">
                <span className="t-body-md-bold tabular">{r.usd}</span>
                <span className="t-body-sm text-alt tabular">{r.balance}</span>
              </span>
              <Chevron dir="right" size={16} color="var(--color-text-muted)" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
