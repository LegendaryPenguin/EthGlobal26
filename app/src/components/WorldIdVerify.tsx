import { useState } from "react";
import { IDKitRequestWidget, proofOfHuman, identityCheck, type IDKitResult } from "@worldcoin/idkit";
import { useAccount, useReadContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import { passportRegistryAbi, STANDING_LABELS } from "../abis/passportRegistry";

const APP_ID = import.meta.env.VITE_WORLD_APP_ID as `app_${string}` | undefined;
const ACTION = (import.meta.env.VITE_WORLD_ACTION_ID as string) || "mint-credit-passport";
// Optional eligibility gate (#3): require a unique human who is ALSO this age via a World ID 4.0
// document credential — proven privately (no birthdate revealed). 0/unset = uniqueness only (default,
// works for any verified phone). Set VITE_WORLD_MIN_AGE=18 to require it (needs a document-verified
// World App: passport/eID).
const MIN_AGE = Number(import.meta.env.VITE_WORLD_MIN_AGE) || 0;
const PASSPORT = import.meta.env.VITE_PASSPORT_REGISTRY_ADDRESS as Address | undefined;
const ZERO_ID = "0x0000000000000000000000000000000000000000000000000000000000000000";

type RpContext = {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
};

/// World ID 4.0 verification (Path A — cloud verify). Flow:
///   1. Ask our server for a signed rp_context (server/verify.ts signs a nonce with the RP key).
///   2. Open IDKitRequestWidget with proofOfHuman → user scans in World App → v4 proof.
///   3. POST the proof to /api/verify, which verifies it with World and mints the passport.
/// On Arc there is no in-contract verifier (docs/05); validation is server-side, which the track
/// permits. signal = the connected wallet, so the RP-scoped nullifier binds this human to one passport.
export function WorldIdVerify() {
  const { address } = useAccount();
  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [status, setStatus] = useState<"idle" | "preparing" | "verifying" | "done" | "error">("idle");
  const [txHash, setTxHash] = useState<string>();
  const [error, setError] = useState<string>();

  // One human = one passport. If this wallet already has a passport on-chain, just show it — no need
  // to re-verify with World (World also caps verifications per human, so re-verifying would error).
  const { data: existingId } = useReadContract({
    address: PASSPORT,
    abi: passportRegistryAbi,
    functionName: "passportIdOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(PASSPORT && address) },
  });
  const { data: standing } = useReadContract({
    address: PASSPORT,
    abi: passportRegistryAbi,
    functionName: "standingOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(PASSPORT && address) },
  });
  // The portable, person-bound credit report — any lender can poll this by wallet.
  const { data: report } = useReadContract({
    address: PASSPORT,
    abi: passportRegistryAbi,
    functionName: "creditReport",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(PASSPORT && address) },
  });

  if (!APP_ID) {
    return <p className="muted">Set VITE_WORLD_APP_ID (World developer portal) to enable World ID — see app/.env.local.</p>;
  }
  if (!address) {
    return <p className="muted">Connect a wallet first — it becomes the signal bound to your passport.</p>;
  }

  // Already verified on this chain → show the existing passport instead of the verify button.
  if (existingId && existingId !== ZERO_ID) {
    return (
      <div className="passport-card">
        <p className="muted">✓ You're verified — one human, one passport.</p>
        <p>
          <strong>Passport ID:</strong> <code>{existingId}</code>
        </p>
        <p>
          <strong>Standing:</strong> {STANDING_LABELS[Number(report?.standing ?? standing ?? 0)] ?? "Unknown"}
        </p>
        {report && (
          <ul className="credit-report muted">
            <li>Credit score: <strong>{Number(report.score)}</strong></li>
            <li>Credit limit: <strong>{formatUnits(report.limit, 6)} USDC</strong></li>
            <li>Loans repaid on time: <strong>{Number(report.onTimePayments)}</strong></li>
            <li>Late marks: <strong>{Number(report.latePayments)}</strong></li>
            <li>Defaults: <strong>{Number(report.defaults)}</strong></li>
          </ul>
        )}
        <p className="muted">
          This credit report is bound to your World ID — any lender can poll it, and it follows you
          across every wallet you use.
        </p>
      </div>
    );
  }

  // Step 1: fetch a signed rp_context, then open the widget.
  const start = async () => {
    setStatus("preparing");
    setError(undefined);
    try {
      const res = await fetch("/api/world/context", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; rp_context?: RpContext; error?: string };
      if (!data.ok || !data.rp_context) throw new Error(data.error ?? "failed to get rp_context");
      setRpContext(data.rp_context);
      setOpen(true);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  // Step 3: after the World App returns a v4 proof, verify + mint on the server.
  const onSuccess = async (result: IDKitResult) => {
    setStatus("verifying");
    setError(undefined);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, signal: address }),
      });
      const data = (await res.json()) as { ok: boolean; txHash?: string; error?: string; detail?: string };
      if (data.ok) {
        setTxHash(data.txHash);
        setStatus("done");
      } else {
        setError(data.detail ?? data.error ?? "verification failed");
        setStatus("error");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const label =
    status === "preparing" ? "Preparing…" : status === "verifying" ? "Verifying + minting…" : status === "done" ? "Passport minted ✓" : "Verify with World ID";

  return (
    <div>
      <button className="btn btn--primary" onClick={start} disabled={status === "preparing" || status === "verifying"}>
        {label}
      </button>
      {rpContext && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={APP_ID}
          action={ACTION}
          rp_context={rpContext}
          // Accept v3 (legacy) proofs too, not just v4-only — World App installs that can't complete
          // a v4-only proof-of-human request (older app / device-verified) fail otherwise. The v4
          // verify endpoint accepts the 3.0 legacy proof shape, and we read responses[].nullifier
          // either way, so this is strictly more permissive.
          allow_legacy_proofs={true}
          preset={
            MIN_AGE > 0
              ? identityCheck({ attributes: [{ type: "minimum_age", value: MIN_AGE }], legacy_signal: address })
              : proofOfHuman({ signal: address })
          }
          onSuccess={onSuccess}
          onError={(code) => {
            setError(String(code));
            setStatus("error");
          }}
        />
      )}
      {status === "done" && txHash && <p className="muted">passport tx: {txHash}</p>}
      {status === "error" && error && <p className="error">{error}</p>}
    </div>
  );
}
