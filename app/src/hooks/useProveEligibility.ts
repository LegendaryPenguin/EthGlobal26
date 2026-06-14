import { useCallback, useState } from "react";
import { proveEligibility, type EligibilityProof } from "../zk/eligibility";

type Status = "idle" | "proving" | "done" | "error";

/**
 * React hook for the in-browser eligibility proof (the ZK gate).
 * The income figure is a private witness inside {proveEligibility} and never enters React state,
 * the network, or any log — only the resulting proof + public inputs are exposed.
 */
export function useProveEligibility() {
  const [status, setStatus] = useState<Status>("idle");
  const [proof, setProof] = useState<EligibilityProof | null>(null);
  const [error, setError] = useState<string>();

  const prove = useCallback(async () => {
    setStatus("proving");
    setError(undefined);
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

  return { status, proof, error, prove };
}
