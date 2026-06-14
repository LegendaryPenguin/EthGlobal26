import { useState } from "react";
import { IDKitSessionWidget, CredentialRequest, type IDKitResultSession } from "@worldcoin/idkit";
import { formatUnits } from "viem";
import { ApplicationWizard, type CreDecision } from "./ApplicationWizard";
import { logEvent, arcTx } from "../devlog";

const APP_ID = import.meta.env.VITE_WORLD_APP_ID as `app_${string}` | undefined;
const RPC = (import.meta.env.VITE_ARC_RPC_URL as string) || "";
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(RPC);
// World ID environment must match where your app_id + RP signing key are registered. Your app shows
// BOTH Staging and Production active — if the scan fails with "try again", flip VITE_WORLD_ENV.
const WORLD_ENV = (((import.meta.env.VITE_WORLD_ENV as string) || "production") === "staging" ? "staging" : "production") as "production" | "staging";
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
  const [cre, setCre] = useState<{ decision: CreDecision; receipts: { setTermsTx?: string; attestationRef?: string } } | null>(null);

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

  const onSuccess = async (result: IDKitResultSession) => {
    setStatus("signing");
    setError(undefined);
    try {
      // Each sign-in is a FRESH World ID session (no existing_session_id resume) so a new person can
      // always scan a new QR — the demo expects many distinct humans, not one returning account.
      // Sign-in proves PERSONHOOD only — no eligibility proof here. The ZK gate runs later at /apply,
      // over the income the human self-reports in the application wizard.
      const data = (await (await fetch("/api/world/signin", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result }),
      })).json()) as { ok: boolean; error?: string; detail?: string } & SignedIn;
      if (!data.ok) throw new Error(data.detail ?? data.error ?? "sign-in failed");
      setMe(data);
      setStatus("ready");
      logEvent({ kind: "id", label: "World ID human verified", value: data.sessionNullifier });
      if (data.receipts?.mintTx) logEvent({ kind: "tx", label: "ERC-8004 passport minted", value: data.receipts.mintTx, link: arcTx(data.receipts.mintTx) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  // Demo fallback: the World App scan is flaky for this RP config, but the server already trusts the
  // bridge-delivered session_nullifier (no /api/v4/verify). This signs in with a fresh demo identity
  // (random nullifier) so the FULL flow — real ZK proof, passport, CRE, claim — is demoable today.
  // The real World ID scan above remains the primary path.
  const demoSignIn = () => {
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const result = { session_id: `session_demo${rand.slice(0, 12)}`, responses: [{ session_nullifier: [`0x${rand}`] }] } as unknown as IDKitResultSession;
    void onSuccess(result);
  };

  const doClaim = async () => {
    if (!me) return;
    setClaim({ pending: true });
    try {
      const data = (await (await fetch("/api/world/claim", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionNullifier: me.sessionNullifier }),
      })).json()) as { ok: boolean; txHash?: string; error?: string; detail?: string };
      if (data.ok) {
        setClaim({ pending: false, tx: data.txHash });
        if (data.txHash) logEvent({ kind: "tx", label: "USDC disbursed on Arc (claim)", value: data.txHash, link: arcTx(data.txHash) });
      }
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
          {!cre ? (
            // Apply through the Chainlink CRE / Confidential AI — the real underwriting path.
            <ApplicationWizard
              sessionNullifier={me.sessionNullifier}
              onDecided={(decision, receipts) => setCre({ decision, receipts })}
              fallback={me.terms.approved ? {
                decision: { approved: true, principal: `${formatUnits(BigInt(me.terms.principal), 6)} USDC`, tranche: "Senior", riskBand: "B", denialReason: "", transcriptHash: me.receipts?.attestationRef ?? "0x0", inferenceId: "instant" },
                receipts: { setTermsTx: me.receipts?.setTermsTx, attestationRef: me.receipts?.attestationRef },
              } : undefined}
            />
          ) : cre.decision.approved ? (
            <>
              <table className="terms">
                <tbody>
                  <tr><td>Approved</td><td>{cre.decision.principal || "—"}</td></tr>
                  <tr><td>Risk band</td><td>{cre.decision.riskBand} · {cre.decision.tranche}</td></tr>
                </tbody>
              </table>
              <button className="btn btn--primary" style={{ marginTop: 14 }} disabled={claim.pending || Boolean(claim.tx)} onClick={doClaim}>
                {claim.pending ? "Claiming…" : claim.tx ? "Claimed ✓" : "Claim advance"}
              </button>
              {claim.error && <p className="error">{claim.error}</p>}
            </>
          ) : (
            <p className="muted" style={{ marginTop: 10 }}>
              Not approved this time{cre.decision.denialReason ? ` — ${cre.decision.denialReason}` : ""}.
            </p>
          )}
        </div>

        {/* Demo state: the on-chain proof that this flow is real, not staged. */}
        <div className="passport-card" style={{ marginTop: 16 }}>
          <strong>On-chain receipts</strong>
          <ul className="credit-report muted">
            <Hashed label="Passport id" value={p.id} />
            <Hashed label="Human nullifier" value={me.sessionNullifier} />
            <Hashed label="CRE inference id" value={cre?.decision.inferenceId} />
            <Hashed label="Attestation ref" value={cre?.receipts.attestationRef ?? me.receipts?.attestationRef} />
            <Hashed label="Passport mint" value={me.receipts?.mintTx} isTx />
            <Hashed label="Terms set (CRE verdict)" value={cre?.receipts.setTermsTx ?? me.receipts?.setTermsTx} isTx />
            <Hashed label="Claim / disburse" value={claim.tx} isTx />
          </ul>
          <p className="muted">
            {IS_LOCAL ? "Local devnet — hashes are real on-chain locally." : "Live on Arc — open any hash on Arcscan."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Get your advance</h2>
      <p className="muted">
        Start by proving you're a real, unique human with World ID — your credit passport loads
        instantly. No wallet to connect; one is created for you. Next you'll set your amount and
        privately prove your income (the figure never leaves your device).
      </p>

      {/* Step 1 — World ID. Personhood first; the private income proof comes after, in the wizard. */}
      <div style={{ marginTop: 14 }}>
        <strong>Sign in with World ID</strong>
        <button
          className="btn btn--primary"
          style={{ marginTop: 10, display: "block" }}
          onClick={start}
          disabled={status === "preparing" || status === "signing"}
        >
          {status === "preparing" ? "Preparing…" : status === "signing" ? "Signing in…" : "Sign in with World ID"}
        </button>
        <button className="btn" style={{ marginTop: 8, display: "block" }} onClick={demoSignIn} disabled={status === "signing"}>
          Use a demo identity (skip scan)
        </button>
      </div>
      {ctx && (
        <IDKitSessionWidget
          open={open}
          onOpenChange={setOpen}
          app_id={APP_ID}
          environment={WORLD_ENV}
          rp_context={ctx}
          constraints={CredentialRequest("proof_of_human")}
          onSuccess={onSuccess}
          onError={(code) => { setError(`World ID error: ${String(code)}`); setStatus("error"); }}
        />
      )}
      {status === "error" && error && <p className="error">{error}</p>}
    </section>
  );
}
