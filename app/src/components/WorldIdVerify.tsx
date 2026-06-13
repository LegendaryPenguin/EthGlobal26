import { useState } from "react";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult } from "@worldcoin/idkit";
import { useAccount } from "wagmi";

const APP_ID = import.meta.env.VITE_WORLD_APP_ID as `app_${string}` | undefined;
const ACTION = (import.meta.env.VITE_WORLD_ACTION_ID as string) || "mint-credit-passport";

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

  if (!APP_ID) {
    return <p className="muted">Set VITE_WORLD_APP_ID (World developer portal) to enable World ID — see app/.env.local.</p>;
  }
  if (!address) {
    return <p className="muted">Connect a wallet first — it becomes the signal bound to your passport.</p>;
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
        setError(data.detail ? `${data.error} (${data.detail})` : data.error ?? "verification failed");
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
          allow_legacy_proofs={false}
          preset={proofOfHuman({ signal: address })}
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
