import { useState, useCallback, useEffect } from "react";

type Att = {
  ok: boolean;
  available?: boolean;
  detail?: string;
  inferenceId?: string;
  model?: string | null;
  status?: string | null;
  endpoint?: string;
  responseDigest?: string | null;
  recomputedDigest?: string | null;
  output?: string | null;
};

const short = (h?: string | null) => (h && h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h ?? "—");
const eq = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.replace(/^0x/i, "").toLowerCase() === b.replace(/^0x/i, "").toLowerCase();

/// Confidential AI attestation verifier (Track: Confidential AI Attester). Re-fetches the inference
/// DIRECTLY from the Chainlink TEE and shows that the on-chain `attestationRef` equals the TEE's
/// response_digest — proving the loan's on-chain terms are bound to a real, independently re-queryable
/// confidential inference, not a hardcoded value.
export function AttestationPanel({ inferenceId, onChainRef }: { inferenceId?: string; onChainRef?: string }) {
  const [att, setAtt] = useState<Att | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = useCallback(async () => {
    if (!inferenceId) return;
    setBusy(true);
    try {
      const r = (await (await fetch(`/api/attestation?id=${encodeURIComponent(inferenceId)}`)).json()) as Att;
      setAtt(r);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }, [inferenceId]);

  useEffect(() => { void verify(); }, [verify]);

  if (!inferenceId) return null;
  const matchesChain = att?.responseDigest && onChainRef ? eq(att.responseDigest, onChainRef) : undefined;
  const integrity = eq(att?.responseDigest, att?.recomputedDigest);

  return (
    <details className="proof-receipt" style={{ marginTop: 16 }}>
      <summary>🔐 Confidential AI attestation — verify it's real, not hardcoded</summary>
      <div style={{ marginTop: 10 }}>
        <span className="zk-badge">Chainlink Confidential AI · TEE inference</span>
        {att?.available === false ? (
          <p className="muted" style={{ marginTop: 8 }}>{att.detail ?? "Attestation reader unavailable."}</p>
        ) : (
          <>
            <ul className="zk-list" style={{ marginTop: 8 }}>
              <li>Inference id: <code>{short(inferenceId)}</code></li>
              <li>Model: <code>{att?.model ?? "—"}</code> · status <code>{att?.status ?? "—"}</code></li>
              <li>TEE response digest: <code>{short(att?.responseDigest)}</code></li>
              <li>On-chain attestationRef: <code>{short(onChainRef)}</code></li>
            </ul>

            {matchesChain === true && (
              <p className="zk-verdict zk-verdict--ok">
                ✓ The on-chain loan terms are bound to this exact TEE inference — re-fetched live from the
                enclave, digest matches the on-chain attestationRef. Not hardcoded.
              </p>
            )}
            {matchesChain === false && (
              <p className="zk-verdict zk-verdict--bad">✗ Digest does not match the on-chain attestationRef.</p>
            )}
            {integrity && <p className="muted zk-note">Integrity: sha256(output) == response_digest ✓</p>}

            {att?.output && (
              <div className="zk-proof" style={{ whiteSpace: "pre-wrap", maxHeight: 140, overflow: "auto" }}>
                <span className="muted">Attested verdict (TEE output):</span>
                <div><code>{att.output.slice(0, 400)}</code></div>
              </div>
            )}
            {att?.endpoint && (
              <p className="muted zk-note">Independently verifiable: anyone with the sandbox key can <code>GET {att.endpoint}</code> and get this same digest.</p>
            )}
            <div className="zk-actions" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => void verify()} disabled={busy}>
                {busy ? "Re-fetching from TEE…" : "Re-verify against the TEE"}
              </button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
