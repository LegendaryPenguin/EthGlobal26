import { useCallback, useState } from "react";
import {
  proveEligibility,
  verifyEligibilityProof,
  tamperProofHex,
  type EligibilityProof,
} from "../zk/eligibility";

type Status = "idle" | "proving" | "done" | "error";
/** Verification lane shown in the demo panel. */
type Verdict =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "valid" }
  | { kind: "rejected"; forged: boolean }
  | { kind: "error"; message: string };

/**
 * React hook for the in-browser eligibility proof (the ZK gate).
 * The income figure is a private witness inside {proveEligibility} and never enters React state,
 * the network, or any log — only the resulting proof + public inputs are exposed.
 *
 * For the demo it also exposes {verify} (prove the proof is accepted) and {forge} (tamper a byte
 * and watch it get rejected) — so the circuit is shown working, not just claimed.
 */
export function useProveEligibility() {
  const [status, setStatus] = useState<Status>("idle");
  const [proof, setProof] = useState<EligibilityProof | null>(null);
  const [error, setError] = useState<string>();
  const [verdict, setVerdict] = useState<Verdict>({ kind: "idle" });

  const prove = useCallback(async () => {
    setStatus("proving");
    setError(undefined);
    setVerdict({ kind: "idle" });
    try {
      const p = await proveEligibility();
      setProof(p);
      setStatus("done");
      return p;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return null;
    }
  }, []);

  /** Verify the real proof — should be accepted. */
  const verify = useCallback(async () => {
    if (!proof) return;
    setVerdict({ kind: "verifying" });
    try {
      const ok = await verifyEligibilityProof(proof.proofHex, proof.publicInputs);
      setVerdict(ok ? { kind: "valid" } : { kind: "rejected", forged: false });
    } catch (e) {
      setVerdict({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [proof]);

  /** Tamper one byte and re-verify — should be rejected (soundness money-shot). */
  const forge = useCallback(async () => {
    if (!proof) return;
    setVerdict({ kind: "verifying" });
    try {
      const forged = tamperProofHex(proof.proofHex);
      const ok = await verifyEligibilityProof(forged, proof.publicInputs);
      // ok === true would mean the forgery slipped through; ok === false is the expected rejection.
      setVerdict(ok ? { kind: "valid" } : { kind: "rejected", forged: true });
    } catch (e) {
      setVerdict({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [proof]);

  return { status, proof, error, verdict, prove, verify, forge };
}
