import { useEffect, useRef, useState } from "react";
import { logEvent, arcTx } from "../devlog";
import { useProveEligibility } from "../hooks/useProveEligibility";
import { ZkProofPanel } from "./ZkProofPanel";
import { POLICY_THRESHOLD, warmupProver } from "../zk/eligibility";

export type CreDecision = {
  approved: boolean; principal: string; tranche: string; riskBand: string;
  denialReason: string; transcriptHash: string; inferenceId: string;
};
type Receipts = { setTermsTx?: string; attestationRef?: string };

const THRESHOLD_YEARLY = Number(POLICY_THRESHOLD); // 12000

/// Friendly 3-step loan application. On "Apply for advance" it runs the REAL Noir/UltraHonk
/// eligibility proof IN THE BACKGROUND over the income the user typed — income never leaves the
/// device; only { proofHex, publicInputs } go to /api/world/apply, which verifies the proof BEFORE
/// underwriting. A collapsible "proof receipt" exposes the proof for judges on demand.
export function ApplicationWizard({
  sessionNullifier,
  onDecided,
  fallback,
}: {
  sessionNullifier: string;
  onDecided: (d: CreDecision, receipts: Receipts) => void;
  fallback?: { decision: CreDecision; receipts: Receipts };
}) {
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState(500);
  const [income, setIncome] = useState(18000);
  const [age, setAge] = useState(25);
  const [country, setCountry] = useState("United States");
  const [occupation, setOccupation] = useState("");
  const [phase, setPhase] = useState<"form" | "proving" | "submitting" | "underwriting" | "denied" | "error">("form");
  const [error, setError] = useState<string>();
  const [id, setId] = useState<string>();
  const poll = useRef<ReturnType<typeof setInterval>>();
  const zk = useProveEligibility();

  // Pre-warm the proving stack so "Apply" doesn't pay the cold wasm-load tax.
  useEffect(() => { void warmupProver(); }, []);

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
    setError(undefined);
    // Instant, honest rejection below the bar — no need to spin up a 45s proof we know would fail.
    if (income < THRESHOLD_YEARLY) {
      setPhase("denied");
      return;
    }
    // 1. Generate the REAL eligibility proof in the background over the typed income (private witness).
    setPhase("proving");
    const proof = await zk.prove({ incomeYearly: income, worldNullifier: sessionNullifier });
    if (!proof) {
      setError(zk.error ?? "could not generate eligibility proof");
      setPhase("error");
      return;
    }
    logEvent({ kind: "proof", label: `ZK eligibility proof generated (UltraHonk, ${proof.ms} ms)`, value: proof.proofHex });

    // 2. Submit ONLY { proofHex, publicInputs } + non-income fields. Income never leaves the device.
    setPhase("submitting");
    try {
      const r = (await (await fetch("/api/world/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionNullifier, requestedPrincipal: `${amount} USDC`, age, country, occupation,
          eligibility: { proofHex: proof.proofHex, publicInputs: proof.publicInputs },
        }),
      })).json()) as { ok: boolean; id?: string; error?: string; detail?: string };
      if (!r.ok || !r.id) throw new Error(r.detail ?? r.error ?? "couldn't submit application");
      logEvent({ kind: "id", label: "CRE application submitted (Confidential AI)", value: r.id });
      setId(r.id);
      setPhase("underwriting");
    } catch (e) {
      if (fallback) {
        logEvent({ kind: "info", label: "CRE unavailable — approved on instant terms" });
        onDecided(fallback.decision, fallback.receipts);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  // Collapsible judge-facing proof receipt — shown once a proof exists, in any phase.
  const receipt = zk.proof ? (
    <details className="proof-receipt" style={{ marginTop: 16 }}>
      <summary>🔎 Proof receipt — show that the ZK proof is real</summary>
      <ZkProofPanel zk={zk} />
    </details>
  ) : null;

  if (phase === "proving") {
    return (
      <div className="wiz">
        <div className="wiz-spinner" aria-hidden="true" />
        <h3 className="wiz-q">Checking your eligibility privately…</h3>
        <p className="muted">
          Generating a <strong>zero-knowledge proof</strong> over your income, <strong>on your device</strong>.
          The number itself never leaves — only a proof that it clears the bar.
        </p>
      </div>
    );
  }

  if (phase === "underwriting") {
    return (
      <div className="wiz">
        <div className="wiz-spinner" aria-hidden="true" />
        <h3 className="wiz-q">Reviewing your application…</h3>
        <p className="muted">
          A private AI underwrites you — your income stayed on your device; only the zero-knowledge
          proof that it clears the bar was shared. Only the decision comes back.
        </p>
        {id && <p className="muted">Chainlink inference: <code>{id.slice(0, 8)}…</code></p>}
        {receipt}
      </div>
    );
  }

  if (phase === "denied") {
    return (
      <div className="wiz">
        <h3 className="wiz-q">You don't meet the bar yet</h3>
        <p className="muted">
          Eligibility needs a reported income of at least <strong>${THRESHOLD_YEARLY.toLocaleString()}/yr</strong>.
          Nothing was shared — the check ran on your device.
        </p>
        <div className="walletbar" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => { setPhase("form"); setStep(1); }}>Back</button>
        </div>
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
      hint: "This never leaves your device — a zero-knowledge proof attests it clears the bar.",
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
          <button className="btn btn--primary" disabled={!canNext} onClick={submit}>Apply for advance</button>
        )}
      </div>
      {phase === "error" && error && <p className="error">{error}</p>}
      {receipt}
    </div>
  );
}
