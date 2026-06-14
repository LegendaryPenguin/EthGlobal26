import { useEffect, useState } from "react";
import { useStore, fmt, routeLine, isCrossChain, type Step } from "../store";
import { TRANCHES, type TrancheId } from "../data/mock";
import { Button, Card, Row } from "../components/ui";
import { BridgeCard } from "../components/BridgeCard";
import { Chevron, CheckCircle } from "../components/Icons";
import { VouchMark } from "../components/VouchMark";

type FlowStep = "tranche" | "amount" | "review";
const STEP_INDEX: Record<FlowStep, number> = { tranche: 1, amount: 2, review: 3 };

function FlowHeader({ step }: { step: FlowStep }) {
  const { dispatch } = useStore();
  const back: Step = step === "tranche" ? "list" : step === "amount" ? "tranche" : "amount";
  return (
    <div className="flowhead">
      <button className="backlink" onClick={() => dispatch({ type: "step", step: back })}>
        <Chevron dir="left" size={16} /> Back
      </button>
      <div className="flowhead__steps">
        {([1, 2, 3] as const).map((i) => (
          <span key={i} className={`stepdot ${STEP_INDEX[step] >= i ? "is-done" : ""}`} />
        ))}
      </div>
    </div>
  );
}

function VouchProductHeader() {
  return (
    <div className="prodhead">
      <VouchMark size={44} />
      <div>
        <div className="t-heading-sm">Veritas — Credit Passport</div>
        <div className="t-body-sm text-alt">6% – 14% APY · USDC</div>
      </div>
    </div>
  );
}

// Step 1 — Pick tranche
function Tranche() {
  const { state, dispatch } = useStore();
  return (
    <div className="flow-narrow">
      <FlowHeader step="tranche" />
      <VouchProductHeader />
      <h2 className="t-heading-md" style={{ margin: "20px 0 4px" }}>Choose your risk strategy</h2>
      <p className="t-body-sm text-alt" style={{ margin: "0 0 16px" }}>
        Conservative is paid first from loan repayments (first-loss protected). Aggressive earns a
        higher risk-priced yield but absorbs losses first — pick your appetite for risk.
      </p>

      {(Object.values(TRANCHES) as (typeof TRANCHES)[TrancheId][]).map((t) => (
        <button
          key={t.id}
          className={`tranche-card ${state.tranche === t.id ? "is-selected" : ""}`}
          onClick={() => dispatch({ type: "tranche", tranche: t.id })}
        >
          <span className="tranche-card__radio" />
          <span className="tranche-card__body">
            <span className="tranche-card__top">
              <span className="t-heading-sm">{t.name}</span>
              <span className="t-heading-sm">{t.apyLabel}</span>
            </span>
            <span className="t-body-sm text-alt">{t.blurb}</span>
            <span className="t-body-xs text-muted">{t.share}</span>
          </span>
        </button>
      ))}

      <Button full size="lg" onClick={() => dispatch({ type: "step", step: "amount" })} style={{ marginTop: 20 }}>
        Continue
      </Button>
    </div>
  );
}

// Step 2 — Source + amount on one Bridge-style card
function Amount() {
  const { state, dispatch } = useStore();
  const t = TRANCHES[state.tranche];
  const amt = Number(state.amount) || 0;
  const yearly = amt * t.apy;
  const valid = amt > 0;
  return (
    <div className="flow-narrow">
      <FlowHeader step="amount" />
      <h2 className="t-heading-md" style={{ margin: "8px 0 4px" }}>Deposit to Vouch {t.name}</h2>
      <p className="t-body-sm text-alt" style={{ margin: "0 0 16px" }}>
        Fund from any token on any chain — {t.apyLabel}.
      </p>
      <BridgeCard mode="amount" />

      <div className="inline-yield">
        <span className="t-body-sm text-alt">Est. annual yield</span>
        <span className="t-body-md-bold" style={{ color: "var(--color-success-default)" }}>${fmt(yearly)} / yr</span>
      </div>

      <Button full size="lg" disabled={!valid} onClick={() => dispatch({ type: "step", step: "review" })} style={{ marginTop: 16 }}>
        Review
      </Button>
    </div>
  );
}

// Step 3 — Review + approve→deposit stepper
function Review() {
  const { state, dispatch } = useStore();
  const t = TRANCHES[state.tranche];
  const amt = Number(state.amount) || 0;
  const yearly = amt * t.apy;
  const route = routeLine(state.sourceChain, state.sourceToken);
  const crossChain = isCrossChain(state);
  return (
    <div className="flow-narrow">
      <FlowHeader step="review" />
      <h2 className="t-heading-md" style={{ margin: "8px 0 16px" }}>Review</h2>

      <Card section className="review-card">
        <Row label="You deposit" value={`${fmt(amt)} USDC`} />
        <Row label="Tranche" value={t.name} />
        <Row label="APY" value={t.apyLabel} />
        <Row label="Est. annual yield" valueNode={<span style={{ color: "var(--color-success-default)" }}>${fmt(yearly)}</span>} />
        <Row label="Route" value={route} />
        <Row label="Network fee" value="~$0.01 (paid in USDC on Arc)" />
        <Row label="Withdrawal" value="Withdraw anytime · subject to pool liquidity" />
      </Card>

      <div className="risk-box t-body-sm">
        Yield comes from real-income-backed undercollateralized loans to verified humans. Junior absorbs
        defaults first; Senior is first-loss protected. Defaults are contained via income-routing, laddered
        limits, identity, and priced-in APY.
      </div>

      {crossChain ? (
        <>
          <div className="stepper">
            <div className="stepper__row is-current">
              <span className="stepper__num">↗</span>
              <span className="t-body-sm-medium">Bridge via CCTP V2 → Arc, then deposit (one flow)</span>
            </div>
          </div>
          <Button full size="lg" onClick={() => dispatch({ type: "modal", modal: "deposit" })}>Bridge &amp; Deposit</Button>
        </>
      ) : (
        <>
          <div className="stepper">
            <div className={`stepper__row ${state.approved ? "is-done" : "is-current"}`}>
              {state.approved ? <CheckCircle size={20} /> : <span className="stepper__num">1</span>}
              <span className="t-body-sm-medium">Approve USDC</span>
            </div>
            <div className={`stepper__row ${state.approved ? "is-current" : ""}`}>
              <span className="stepper__num">2</span>
              <span className="t-body-sm-medium">Deposit</span>
            </div>
          </div>
          {!state.approved ? (
            <Button full size="lg" onClick={() => dispatch({ type: "modal", modal: "approve" })}>Approve</Button>
          ) : (
            <Button full size="lg" onClick={() => dispatch({ type: "modal", modal: "deposit" })}>Deposit</Button>
          )}
        </>
      )}
    </div>
  );
}

// Success / position
function Success() {
  const { state, dispatch } = useStore();
  const pos = state.position;
  const t = TRANCHES[pos ? pos.tranche : state.tranche];
  const principal = pos?.principal ?? 0;

  // Mock accrued-yield ticker (demo flavour). DESIGN_SPEC §5 Screen 8.
  const [accrued, setAccrued] = useState(0);
  useEffect(() => {
    const perSec = (principal * t.apy) / (365 * 24 * 3600);
    const id = setInterval(() => setAccrued((a) => a + perSec), 1000);
    return () => clearInterval(id);
  }, [principal, t.apy]);

  return (
    <div className="flow-narrow">
      <div className="success-head">
        <CheckCircle size={40} halo />
        <h2 className="t-heading-md" style={{ margin: "16px 0 4px" }}>Deposit complete</h2>
        <p className="t-body-md text-alt" style={{ margin: 0 }}>
          Your USDC is now earning in the Vouch {t.name} tranche.
        </p>
        {state.live && state.depositTx ? (
          <a className="t-body-sm-medium" style={{ marginTop: 10 }} href={`https://testnet.arcscan.app/tx/${state.depositTx}`} target="_blank" rel="noreferrer">
            View transaction on Arcscan ↗
          </a>
        ) : (
          <span className="pill pill--neutral" style={{ marginTop: 12 }}>Simulated · demo only</span>
        )}
      </div>

      <Card section className="position-card">
        <div className="position-card__head">
          <div className="prodhead" style={{ margin: 0 }}>
            <VouchMark size={36} />
            <div>
              <div className="t-body-md-bold">Vouch — {t.name}</div>
              <span className="pill pill--neutral">{t.pill}</span>
            </div>
          </div>
          <span className="t-heading-sm">{t.apyLabel}</span>
        </div>
        <div className="position-card__grid">
          <Row label="Principal" value={`${fmt(principal)} USDC`} />
          <Row label="Current value" value={`${fmt(principal + accrued)} USDC`} />
          <Row label="Accrued yield" valueNode={<span style={{ color: "var(--color-success-default)" }}>+${accrued.toFixed(4)}</span>} />
          <Row label="Live APY" value={t.apyLabel} />
        </div>
        <div className="position-card__actions">
          <Button variant="secondary" full onClick={() => dispatch({ type: "startDeposit" })}>Add</Button>
          <Button full onClick={() => dispatch({ type: "modal", modal: "withdraw" })}>Withdraw</Button>
        </div>
        <button className="textlink t-body-sm-medium" onClick={() => dispatch({ type: "tab", tab: "activity" })}>
          View activity
        </button>
      </Card>
    </div>
  );
}

export function DepositFlow() {
  const { state } = useStore();
  switch (state.step) {
    case "tranche":
      return <Tranche />;
    case "amount":
      return <Amount />;
    case "review":
      return <Review />;
    case "success":
      return <Success />;
    default:
      return null;
  }
}
