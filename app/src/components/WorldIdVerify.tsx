import { useState } from "react";
import { IDKitWidget, type ISuccessResult, VerificationLevel } from "@worldcoin/idkit";
import { useAccount } from "wagmi";

const APP_ID = import.meta.env.VITE_WORLD_APP_ID as `app_${string}` | undefined;
const ACTION = (import.meta.env.VITE_WORLD_ACTION_ID as string) || "mint-credit-passport";

/// World ID verification (Path A — cloud verify). The proof is POSTed to our own /api/verify endpoint
/// (server/verify.ts), which validates it against World's cloud API and then mints the passport via a
/// relayer. On Arc there is no in-contract World ID verifier (docs/05), so validation happens in the
/// backend — which the track permits ("backend OR on-chain"). signal = the connected wallet, so the
/// nullifier binds this human to one passport; a locked-out human is rejected by PassportRegistry.
export function WorldIdVerify() {
  const { address } = useAccount();
  const [status, setStatus] = useState<"idle" | "verifying" | "done" | "error">("idle");
  const [txHash, setTxHash] = useState<string>();
  const [error, setError] = useState<string>();

  if (!APP_ID) {
    return (
      <p className="muted">
        Set VITE_WORLD_APP_ID (World developer portal) to enable World ID — see app/.env.local.
      </p>
    );
  }
  if (!address) {
    return <p className="muted">Connect a wallet first — it becomes the signal bound to your passport.</p>;
  }

  const onSuccess = async (result: ISuccessResult) => {
    setStatus("verifying");
    setError(undefined);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: result, signal: address }),
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

  return (
    <div>
      <IDKitWidget app_id={APP_ID} action={ACTION} signal={address} verification_level={VerificationLevel.Orb} onSuccess={onSuccess}>
        {({ open }) => (
          <button className="btn btn--primary" onClick={open} disabled={status === "verifying"}>
            {status === "verifying" ? "Verifying + minting…" : status === "done" ? "Passport minted ✓" : "Verify with World ID"}
          </button>
        )}
      </IDKitWidget>
      {status === "done" && txHash && <p className="muted">passport tx: {txHash}</p>}
      {status === "error" && error && <p className="error">{error}</p>}
    </div>
  );
}
