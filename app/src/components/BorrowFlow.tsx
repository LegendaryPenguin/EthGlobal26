import { useState } from "react";
import { IDKitSessionWidget, CredentialRequest, type IDKitResult } from "@worldcoin/idkit";
import { formatUnits } from "viem";
import { useProveEligibility } from "../hooks/useProveEligibility";

const APP_ID = import.meta.env.VITE_WORLD_APP_ID as `app_${string}` | undefined;
const RPC = (import.meta.env.VITE_ARC_RPC_URL as string) || "";
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(RPC);
const SESSION_KEY = "vouch.session_id";
const STANDING = ["Unverified", "Good", "Late", "Defaulted", "Locked out"];

type RpContext = { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
type Passport = { id: string; standing: number; limit: string; score: number; onTimePayments: number; latePayments: number; defaults: number };
type Terms = { principal: string; aprBps: number; approved: boolean };
type Receipts = { mintTx?: string; setTermsTx?: string; attestationRef?: string };
type SignedIn = { wallet: string; sessionNullifier: string; passport: Passport; terms: Terms; receipts?: Receipts };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/// A tx-hash / hash row that links to Arcscan on testnet (local hashes are shown but not linked).
function Hashed({ label, value, isTx }: { label: string; value?: string; isTx?: boolean }) {
  if (!value) return null;
  const href = isTx && !IS_LOCAL ? `https://testnet.arcscan.app/tx/${value}` : undefined;
  return (
    <li>
      {label}:{" "}
      {href ? (
        <a className="tlink" href={href} target="_blank" rel="noreferrer"><code>{short(value)}</code></a>
      ) : (
        <code>{short(value)}</code>
      )}
      {isTx && IS_LOCAL ? <span className="muted"> (local)</span> : null}
    </li>
  );
}

/// The demo money-shot: makes the in-browser Noir/UltraHonk proof *visible*. Shows what stayed
/// private (income) vs the only values shared (public inputs — no income), the real proof artifact,
/// a live "✓ Verified", and a "Try to forge it" button that tampers a byte and gets rejected.
function ZkProofPanel({ zk }: { zk: ReturnType<typeof useProveEligibility> }) {
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
            <li>Monthly income: <code>•••••</code> <span className="muted">(never sent)</span></li>
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
        <button
          className="btn"
          onClick={() => { void zk.verify(); }}
          disabled={v.kind === "verifying"}
        >
          {v.kind === "verifying" ? "Verifying…" : "Verify proof"}
        </button>
        <button
          className="btn btn--danger"
          onClick={() => { void zk.forge(); }}
          disabled={v.kind === "verifying"}
        >
          Try to forge it
        </button>
      </div>

      {v.kind === "valid" && (
        <p className="zk-verdict zk-verdict--ok">✓ Verified — the verifier accepts this proof.</p>
      )}
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

/// Identity-first borrow flow: Sign in with World ID (a *session* — repeatable, no re-verify wall).
/// The server identifies the human, provisions a custodial wallet for them, mints/loads the passport,
/// and signs the claim — so a new borrower onboards by scanning, no MetaMask needed.
export function BorrowFlow() {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<RpContext | null>(null);
  const [status, setStatus] = useState<"idle" | "preparing" | "signing" | "ready" | "error">("idle");
  const [me, setMe] = useState<SignedIn | null>(null);
  const [error, setError] = useState<string>();
  const [claim, setClaim] = useState<{ pending: boolean; tx?: string; error?: string }>({ pending: false });
  const zk = useProveEligibility();

  if (!APP_ID) {
    return <p className="muted">Set VITE_WORLD_APP_ID to enable World ID sign-in (app/.env.local).</p>;
  }

  const start = async () => {
    setStatus("preparing");
    setError(undefined);
    try {
      const data = (await (await fetch("/api/world/session-context", { method: "POST" })).json()) as { ok: boolean; rp_context?: RpContext; error?: string };
      if (!data.ok || !data.rp_context) throw new Error(data.error ?? "could not start session");
      setCtx(data.rp_context);
      setOpen(true);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const onSuccess = async (result: IDKitResult) => {
    setStatus("signing");
    setError(undefined);
    try {
      const sid = (result as { session_id?: string }).session_id;
      if (sid) localStorage.setItem(SESSION_KEY, sid);
      // The ZK gate: attach the in-browser eligibility proof. Income never leaves the device —
      // only the proof + public inputs (income absent) are sent.
      const eligibility = zk.proof
        ? { proofHex: zk.proof.proofHex, publicInputs: zk.proof.publicInputs }
        : undefined;
      const data = (await (await fetch("/api/world/signin", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result, eligibility }),
      })).json()) as { ok: boolean; error?: string; detail?: string } & SignedIn;
      if (!data.ok) throw new Error(data.detail ?? data.error ?? "sign-in failed");
      setMe(data);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const doClaim = async () => {
    if (!me) return;
    setClaim({ pending: true });
    try {
      const data = (await (await fetch("/api/world/claim", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionNullifier: me.sessionNullifier }),
      })).json()) as { ok: boolean; txHash?: string; error?: string; detail?: string };
      if (data.ok) setClaim({ pending: false, tx: data.txHash });
      else setClaim({ pending: false, error: data.detail ?? data.error });
    } catch (e) {
      setClaim({ pending: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  // Signed in → show the human's passport + terms + claim.
  if (me) {
    const p = me.passport;
    return (
      <section className="card">
        <h2>You're verified ✓</h2>
        <p className="muted">A unique human — no wallet needed. Your passport is bound to you.</p>
        <div className="passport-card">
          <p className="muted">Managed wallet: <code>{short(me.wallet)}</code></p>
          <p><strong>Standing:</strong> {STANDING[p.standing] ?? "Unknown"}</p>
          <ul className="credit-report muted">
            <li>Credit score: <strong>{p.score}</strong></li>
            <li>Credit limit: <strong>{formatUnits(BigInt(p.limit), 6)} USDC</strong></li>
            <li>On-time: <strong>{p.onTimePayments}</strong></li>
            <li>Late: <strong>{p.latePayments}</strong></li>
            <li>Defaults: <strong>{p.defaults}</strong></li>
          </ul>
        </div>
        <div style={{ marginTop: 16 }}>
          <strong>Your advance</strong>
          {me.terms.approved ? (
            <table className="terms">
              <tbody>
                <tr><td>Principal</td><td>{formatUnits(BigInt(me.terms.principal), 6)} USDC</td></tr>
                <tr><td>APR</td><td>{(me.terms.aprBps / 100).toFixed(2)}%</td></tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">No approved terms yet.</p>
          )}
          <button className="btn btn--primary" style={{ marginTop: 14 }} disabled={!me.terms.approved || claim.pending || Boolean(claim.tx)} onClick={doClaim}>
            {claim.pending ? "Claiming…" : claim.tx ? "Claimed ✓" : "Claim advance"}
          </button>
          {claim.error && <p className="error">{claim.error}</p>}
        </div>

        {/* Phase 5 — demo state: the on-chain proof that this flow is real, not staged. */}
        <div className="passport-card" style={{ marginTop: 16 }}>
          <strong>On-chain receipts</strong>
          <ul className="credit-report muted">
            <Hashed label="Passport id" value={p.id} />
            <Hashed label="Human nullifier" value={me.sessionNullifier} />
            <Hashed label="Attestation ref" value={me.receipts?.attestationRef} />
            <Hashed label="Passport mint" value={me.receipts?.mintTx} isTx />
            <Hashed label="Terms set (verdict)" value={me.receipts?.setTermsTx} isTx />
            <Hashed label="Claim / disburse" value={claim.tx} isTx />
          </ul>
          <p className="muted">
            {IS_LOCAL ? "Local devnet — hashes are real on-chain locally." : "Live on Arc — open any hash on Arcscan."}
          </p>
        </div>
      </section>
    );
  }

  const savedSid = localStorage.getItem(SESSION_KEY) ?? undefined;
  const proven = zk.status === "done";
  return (
    <section className="card">
      <h2>Get your advance</h2>
      <p className="muted">
        Two steps: first prove privately that your income qualifies (the figure never leaves your
        device), then sign in with World ID — your credit passport loads instantly. No wallet to
        connect; one is created for you.
      </p>

      {/* Step 1 — the ZK gate. Proof is generated in-browser; income is a private witness. */}
      <div className="passport-card" style={{ marginTop: 14 }}>
        <strong>Step 1 · Prove eligibility privately</strong>
        <p className="muted" style={{ marginTop: 6 }}>
          Generates a zero-knowledge proof in your browser that your income clears the threshold and
          you're not on the default list — without revealing the amount.
        </p>
        <button
          className="btn"
          style={{ marginTop: 10 }}
          onClick={() => { void zk.prove(); }}
          disabled={zk.status === "proving" || proven}
        >
          {zk.status === "proving" ? "Proving in your browser…" : proven ? "Eligibility proven ✓" : "Prove eligibility"}
        </button>
        {zk.status === "proving" && (
          <p className="muted" style={{ marginTop: 8 }}>
            Running the Noir circuit through the UltraHonk prover in a WASM worker… this is real
            cryptography, it takes a few seconds.
          </p>
        )}
        {zk.status === "error" && zk.error && <p className="error">{zk.error}</p>}

        {proven && zk.proof && <ZkProofPanel zk={zk} />}
      </div>

      {/* Step 2 — sign in, gated on the proof. */}
      <div style={{ marginTop: 14 }}>
        <strong>Step 2 · Sign in with World ID</strong>
        <button
          className="btn btn--primary"
          style={{ marginTop: 10, display: "block" }}
          onClick={start}
          disabled={!proven || status === "preparing" || status === "signing"}
        >
          {status === "preparing" ? "Preparing…" : status === "signing" ? "Signing in…" : "Sign in with World ID"}
        </button>
        {!proven && <p className="muted" style={{ marginTop: 6 }}>Complete Step 1 to unlock sign-in.</p>}
      </div>
      {ctx && (
        <IDKitSessionWidget
          open={open}
          onOpenChange={setOpen}
          app_id={APP_ID}
          rp_context={ctx}
          constraints={CredentialRequest("proof_of_human")}
          existing_session_id={savedSid as `session_${string}` | undefined}
          onSuccess={onSuccess}
          onError={(code) => { setError(String(code)); setStatus("error"); }}
        />
      )}
      {status === "error" && error && <p className="error">{error}</p>}
    </section>
  );
}
