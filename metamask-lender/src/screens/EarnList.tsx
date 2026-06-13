import { useStore } from "../store";
import { STAKING_PROVIDERS, PROVIDER_COLORS, VOUCH, TRANCHES } from "../data/mock";
import { Card, Pill } from "../components/ui";
import { Chevron, FoxLogo } from "../components/Icons";
import { VouchMark } from "../components/VouchMark";

function ProviderIcon({ kind }: { kind: "metamask" | "lido" | "rocket" }) {
  if (kind === "metamask") {
    return (
      <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--color-background-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <FoxLogo size={28} />
      </span>
    );
  }
  return (
    <span style={{ width: 40, height: 40, borderRadius: "50%", background: PROVIDER_COLORS[kind], color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flex: "none" }}>
      {kind === "lido" ? "L" : "R"}
    </span>
  );
}

// Screen 2 — Earn/Stake provider list. Vouch sits alongside native staking. DESIGN_SPEC §5.
export function EarnList() {
  const { state, dispatch } = useStore();

  return (
    <div>
      <h1 className="t-heading-md page-title">Stake</h1>
      <p className="t-body-sm text-alt" style={{ margin: "0 0 20px" }}>
        Put your assets to work. Choose a provider to start earning.
      </p>

      <div className="earn-section-label t-body-sm-medium text-alt">Featured</div>

      {/* Vouch — the real entry */}
      <Card className="earn-row earn-row--feature" onClick={() => dispatch({ type: "step", step: "tranche" })}>
        <div className="earn-row__l">
          <VouchMark size={44} />
          <div className="earn-row__meta">
            <div className="earn-row__title">
              <span className="t-body-md-bold">{VOUCH.name}</span>
              <Pill tone="neutral">{VOUCH.tag}</Pill>
            </div>
            <div className="t-body-sm text-alt">{VOUCH.subtext}</div>
            <div className="t-body-xs text-muted" style={{ marginTop: 2 }}>{VOUCH.utilization}</div>
          </div>
        </div>
        <div className="earn-row__r">
          <span className="t-heading-sm">{VOUCH.apyRange}</span>
          <span className="t-body-xs text-alt">
            {TRANCHES[0].apyLabel} – {TRANCHES[1].apyLabel}
          </span>
          <Chevron dir="right" size={18} color="var(--color-text-alternative)" />
        </div>
      </Card>

      <div className="earn-section-label t-body-sm-medium text-alt">Staking</div>

      {STAKING_PROVIDERS.map((p) => (
        <Card key={p.name} className={`earn-row ${p.live ? "" : "earn-row--muted"}`}>
          <div className="earn-row__l">
            <ProviderIcon kind={p.kind} />
            <div className="earn-row__meta">
              <div className="t-body-md-bold">{p.name}</div>
              <div className="t-body-sm text-alt">{p.asset} · {p.note}</div>
            </div>
          </div>
          <div className="earn-row__r earn-row__r--inline">
            <span className="t-body-md-bold">{p.apr}</span>
            {p.live ? <Chevron dir="right" size={18} color="var(--color-text-alternative)" /> : <Pill tone="neutral">Coming soon</Pill>}
          </div>
        </Card>
      ))}

      <p className="t-body-xs text-muted" style={{ marginTop: 16 }}>
        APYs are estimates and vary with pool conditions.{state.position ? " You have an active Vouch position — see the Tokens tab." : ""}
      </p>
    </div>
  );
}
