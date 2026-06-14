import type { useProveEligibility } from "../hooks/useProveEligibility";

const short = (h: string) => (h && h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);

/// The judge-facing "proof receipt" visual: makes the in-browser Noir/UltraHonk proof VISIBLE.
/// Shows what stayed private (income) vs the only values shared (public inputs — no income), the real
/// proof artifact size + hex, a live "✓ Verified", and a "Try to forge it" that tampers a byte and
/// gets rejected. Kept in a shared component so the ApplicationWizard receipt reuses it.
export function ZkProofPanel({ zk }: { zk: ReturnType<typeof useProveEligibility> }) {
  const p = zk.proof;
  if (!p) return null;
  const proofBytes = Math.round((p.proofHex.length - 2) / 2);
  const proofKb = (proofBytes / 1024).toFixed(1);
  const v = zk.verdict;

  return (
    <div style={{ marginTop: 12 }}>
      <span className="zk-badge">Real ZK proof · UltraHonk · generated in {p.ms} ms</span>

      <div className="zk-split">
        <div className="zk-col zk-col--private">
          <div className="zk-col__head">🔒 Private — stayed on your device</div>
          <ul className="zk-list">
            <li>Income (yearly): <code>•••••</code> <span className="muted">(never sent)</span></li>
            <li>Income blinding: <code>•••••</code></li>
            <li>Borrower secret: <code>•••••</code></li>
          </ul>
          <p className="muted zk-note">None of these are public inputs or network payloads.</p>
        </div>
        <div className="zk-col zk-col--public">
          <div className="zk-col__head">🌐 Public — the only values shared</div>
          <ul className="zk-list">
            <li>Threshold: <code>{p.inputs.threshold}</code></li>
            <li>Default-list root: <code>{short(p.inputs.defaultListRoot)}</code></li>
            <li>Income commitment: <code>{short(p.inputs.incomeCommitment)}</code></li>
            <li>Nullifier: <code>{short(p.inputs.nullifier)}</code></li>
          </ul>
          <p className="muted zk-note">Notice: there is no income figure here.</p>
        </div>
      </div>

      <div className="zk-proof">
        <span className="muted">Proof artifact</span>{" "}
        <strong>{proofKb} KB</strong> <span className="muted">·</span>{" "}
        <code>{p.proofHex.slice(0, 22)}…{p.proofHex.slice(-12)}</code>
      </div>

      <div className="zk-actions">
        <button className="btn" onClick={() => { void zk.verify(); }} disabled={v.kind === "verifying"}>
          {v.kind === "verifying" ? "Verifying…" : "Verify proof"}
        </button>
        <button className="btn btn--danger" onClick={() => { void zk.forge(); }} disabled={v.kind === "verifying"}>
          Try to forge it
        </button>
      </div>

      {v.kind === "valid" && <p className="zk-verdict zk-verdict--ok">✓ Verified — the verifier accepts this proof.</p>}
      {v.kind === "rejected" && (
        <p className="zk-verdict zk-verdict--bad">
          {v.forged
            ? "✗ Rejected — one tampered byte and the proof is worthless. It's unforgeable."
            : "✗ Rejected."}
        </p>
      )}
      {v.kind === "error" && <p className="error">{v.message}</p>}
    </div>
  );
}
