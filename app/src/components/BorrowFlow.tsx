import { useState } from "react";
import { IDKitSessionWidget, CredentialRequest, type IDKitResult } from "@worldcoin/idkit";
import { formatUnits } from "viem";

const APP_ID = import.meta.env.VITE_WORLD_APP_ID as `app_${string}` | undefined;
const SESSION_KEY = "vouch.session_id";
const STANDING = ["Unverified", "Good", "Late", "Defaulted", "Locked out"];

type RpContext = { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
type Passport = { id: string; standing: number; limit: string; score: number; onTimePayments: number; latePayments: number; defaults: number };
type Terms = { principal: string; aprBps: number; approved: boolean };
type SignedIn = { wallet: string; sessionNullifier: string; passport: Passport; terms: Terms };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

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
      const data = (await (await fetch("/api/world/signin", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result }),
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
          {claim.tx && <p className="muted">tx: <code>{claim.tx}</code></p>}
          {claim.error && <p className="error">{claim.error}</p>}
        </div>
      </section>
    );
  }

  const savedSid = localStorage.getItem(SESSION_KEY) ?? undefined;
  return (
    <section className="card">
      <h2>Get your advance</h2>
      <p className="muted">
        Sign in with World ID — prove you're a unique human and your credit passport loads instantly.
        No wallet to connect; one is created for you.
      </p>
      <button className="btn btn--primary" style={{ marginTop: 14 }} onClick={start} disabled={status === "preparing" || status === "signing"}>
        {status === "preparing" ? "Preparing…" : status === "signing" ? "Signing in…" : "Sign in with World ID"}
      </button>
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
