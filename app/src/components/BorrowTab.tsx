import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import { loanRegistryAbi, loanVaultAbi } from "../abis/loanRegistry";
import { passportRegistryAbi, STANDING_LABELS } from "../abis/passportRegistry";
import { WorldIdVerify } from "./WorldIdVerify";

const LOAN_REGISTRY = import.meta.env.VITE_LOAN_REGISTRY_ADDRESS as Address | undefined;
const LOAN_VAULT = import.meta.env.VITE_LOAN_VAULT_ADDRESS as Address | undefined;
const PASSPORT = import.meta.env.VITE_PASSPORT_REGISTRY_ADDRESS as Address | undefined;

/// The documented borrow flow (docs/02 + docs/06). Steps gated by later stages are labelled with
/// the stage that delivers them; the live wiring here is the read of the LoanRegistry seam.
export function BorrowTab() {
  const { address, isConnected } = useAccount();

  const { data: terms, isLoading } = useReadContract({
    address: LOAN_REGISTRY,
    abi: loanRegistryAbi,
    functionName: "getTerms",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(LOAN_REGISTRY && address) },
  });

  const { data: standing } = useReadContract({
    address: PASSPORT,
    abi: passportRegistryAbi,
    functionName: "standingOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(PASSPORT && address) },
  });

  const { writeContract, isPending, data: txHash, error } = useWriteContract();

  const approved = terms?.approved ?? false;

  return (
    <section className="card">
      <h2>Borrow — with invisible income</h2>
      <ol className="flow">
        <li>
          <strong>1 · Verify you're a unique human</strong> — World ID, validated on-chain.
          <p className="muted">Mints/locks one ERC-8004 passport per human. Anti-respawn.</p>
          {PASSPORT && address && (
            <p className="muted">
              Passport standing:{" "}
              <strong>{STANDING_LABELS[Number(standing ?? 0)] ?? "Unknown"}</strong>
            </p>
          )}
          <WorldIdVerify />
        </li>
        <li>
          <strong>2 · Prove eligibility privately</strong> — Noir proof (income ≥ threshold) in your
          browser; the figure never leaves your device.
          <span className="stage">Stage 5</span>
        </li>
        <li>
          <strong>3 · Private underwriting</strong> — Chainlink Confidential AI in a TEE writes only
          the verdict on-chain (no income data ever touches the chain).
          <span className="stage">Stage 3</span>
        </li>
        <li>
          <strong>4 · Your loan terms (live from the seam)</strong>
          {!LOAN_REGISTRY ? (
            <p className="muted">Set VITE_LOAN_REGISTRY_ADDRESS after deploying LoanRegistry.</p>
          ) : !isConnected ? (
            <p className="muted">Connect your wallet to read your terms.</p>
          ) : isLoading ? (
            <p className="muted">Reading LoanRegistry.getTerms…</p>
          ) : approved ? (
            <table className="terms">
              <tbody>
                <tr>
                  <td>Principal</td>
                  <td>{formatUnits(terms!.principal, 6)} USDC</td>
                </tr>
                <tr>
                  <td>APR</td>
                  <td>{(terms!.aprBps / 100).toFixed(2)}%</td>
                </tr>
                <tr>
                  <td>Risk band</td>
                  <td>{terms!.riskBand}</td>
                </tr>
                <tr>
                  <td>Expires</td>
                  <td>
                    {terms!.expiry
                      ? new Date(Number(terms!.expiry) * 1000).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">No approved terms yet — complete steps 1–3.</p>
          )}
        </li>
        <li>
          <strong>5 · Claim — USDC disburses on Arc in seconds</strong>
          <span className="stage">Stage 2</span>
          <div>
            <button
              className="btn btn--primary"
              disabled={!approved || !LOAN_VAULT || isPending}
              onClick={() =>
                LOAN_VAULT &&
                writeContract({ address: LOAN_VAULT, abi: loanVaultAbi, functionName: "claim" })
              }
            >
              {isPending ? "Claiming…" : "Claim loan"}
            </button>
            {!LOAN_VAULT && <span className="muted"> Set VITE_LOAN_VAULT_ADDRESS to enable.</span>}
            {txHash && <p className="muted">tx: {txHash}</p>}
            {error && <p className="error">{error.message}</p>}
          </div>
        </li>
      </ol>
    </section>
  );
}
