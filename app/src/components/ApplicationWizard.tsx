import { useEffect, useRef, useState } from "react";
import { logEvent, arcTx } from "../devlog";

export type CreDecision = {
  approved: boolean; principal: string; tranche: string; riskBand: string;
  denialReason: string; transcriptHash: string; inferenceId: string;
};
type Receipts = { setTermsTx?: string; attestationRef?: string };

/// Friendly 3-step loan application that routes through the Chainlink CRE / Confidential AI.
/// Plain language, one question per step — built for people who aren't crypto-native. On submit it
/// POSTs /api/world/apply (→ /trigger) and polls /api/world/decision until the verdict lands on-chain.
export function ApplicationWizard({
  sessionNullifier,
  onDecided,
  fallback,
}: {
  sessionNullifier: string;
  onDecided: (d: CreDecision, receipts: Receipts) => void;
  // If the CRE (/trigger) is unavailable, complete with these instant pre-approved terms so the
  // demo isn't blocked by an external dependency. The CRE path is preferred when it's up.
  fallback?: { decision: CreDecision; receipts: Receipts };
}) {
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState(500);
  const [income, setIncome] = useState(18000);
  const [age, setAge] = useState(25);
  const [country, setCountry] = useState("United States");
  const [occupation, setOccupation] = useState("");
  const [phase, setPhase] = useState<"form" | "submitting" | "underwriting" | "error">("form");
  const [error, setError] = useState<string>();
  const [id, setId] = useState<string>();
  const poll = useRef<ReturnType<typeof setInterval>>();

  // Poll the on-chain decision every 5s once we have an inference id.
  useEffect(() => {
    if (phase !== "underwriting" || !id) return;
    const tick = async () => {
      try {
        const d = (await (await fetch("/api/world/decision", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionNullifier, id }),
        })).json()) as { decided?: boolean; decision?: CreDecision; receipts?: Receipts };
        if (d.decided && d.decision) {
          if (poll.current) clearInterval(poll.current);
          logEvent({ kind: "proof", label: `CRE verdict: ${d.decision.approved ? "approved" : "denied"} · band ${d.decision.riskBand}`, value: d.decision.transcriptHash });
          if (d.receipts?.setTermsTx) logEvent({ kind: "tx", label: "Terms written on Arc (setTerms)", value: d.receipts.setTermsTx, link: arcTx(d.receipts.setTermsTx) });
          onDecided(d.decision, d.receipts ?? {});
        }
      } catch { /* keep polling */ }
    };
    poll.current = setInterval(tick, 5000);
    void tick();
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [phase, id, sessionNullifier, onDecided]);

  const submit = async () => {
    setPhase("submitting"); setError(undefined);
    try {
      const r = (await (await fetch("/api/world/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionNullifier, requestedPrincipal: `${amount} USDC`, income, age, country, occupation }),
      })).json()) as { ok: boolean; id?: string; error?: string; detail?: string };
      if (!r.ok || !r.id) throw new Error(r.detail ?? r.error ?? "couldn't submit application");
      logEvent({ kind: "id", label: "CRE application submitted (Confidential AI)", value: r.id });
      setId(r.id);
      setPhase("underwriting");
    } catch (e) {
      // CRE unavailable (e.g. /trigger empty). Don't dead-end the demo — fall back to instant terms.
      if (fallback) {
        logEvent({ kind: "info", label: "CRE unavailable — approved on instant terms" });
        onDecided(fallback.decision, fallback.receipts);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  if (phase === "underwriting") {
    return (
      <div className="wiz">
        <div className="wiz-spinner" aria-hidden="true" />
        <h3 className="wiz-q">Reviewing your application…</h3>
        <p className="muted">
          A private AI is reading your income <strong>inside a sealed enclave</strong> — your numbers never leave it.
          Only the decision comes back.
        </p>
        {id && <p className="muted">Chainlink inference: <code>{id.slice(0, 8)}…</code></p>}
      </div>
    );
  }

  const steps = [
    {
      q: "How much do you need?",
      hint: "You can adjust this anytime.",
      body: (
        <div>
          <div className="wiz-amount">${amount.toLocaleString()}</div>
          <input className="wiz-range" type="range" min={100} max={2000} step={50}
            value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          <div className="wiz-range-ends"><span>$100</span><span>$2,000</span></div>
        </div>
      ),
    },
    {
      q: "What do you earn in a year?",
      hint: "This stays private — it's checked inside a sealed enclave, never shared.",
      body: (
        <label className="field">
          Yearly income (USD)
          <input inputMode="numeric" value={income}
            onChange={(e) => setIncome(Number(e.target.value.replace(/\D/g, "")) || 0)} />
        </label>
      ),
    },
    {
      q: "A few quick details",
      hint: "Last step.",
      body: (
        <div>
          <label className="field">Age
            <input inputMode="numeric" value={age}
              onChange={(e) => setAge(Number(e.target.value.replace(/\D/g, "")) || 0)} />
          </label>
          <label className="field">Country
            <input value={country} onChange={(e) => setCountry(e.target.value)} />
          </label>
          <label className="field">What do you do?
            <input placeholder="e.g. freelance designer" value={occupation}
              onChange={(e) => setOccupation(e.target.value)} />
          </label>
        </div>
      ),
    },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;
  const canNext = step === 0 ? amount > 0 : step === 1 ? income > 0 : age >= 18;

  return (
    <div className="wiz">
      <div className="wiz-dots">
        {steps.map((_, i) => <span key={i} className={i === step ? "wiz-dot wiz-dot--on" : "wiz-dot"} />)}
      </div>
      <h3 className="wiz-q">{s.q}</h3>
      <div style={{ margin: "14px 0" }}>{s.body}</div>
      <p className="muted">{step === 2 && age < 18 ? "You must be 18 or older." : s.hint}</p>
      <div className="walletbar" style={{ marginTop: 12 }}>
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        {!last && <button className="btn btn--primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</button>}
        {last && (
          <button className="btn btn--primary" disabled={!canNext || phase === "submitting"} onClick={submit}>
            {phase === "submitting" ? "Submitting…" : "Apply for advance"}
          </button>
        )}
      </div>
      {phase === "error" && error && <p className="error">{error}</p>}
    </div>
  );
}
