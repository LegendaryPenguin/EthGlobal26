import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import { loanRegistryAbi, loanVaultAbi } from "../abis/loanRegistry";
import { WorldIdVerify } from "./WorldIdVerify";

const LOAN_REGISTRY = import.meta.env.VITE_LOAN_REGISTRY_ADDRESS as Address | undefined;
const LOAN_VAULT = import.meta.env.VITE_LOAN_VAULT_ADDRESS as Address | undefined;

/// The real borrow flow: World ID verify (→ passport + credit report), read the attested terms from
/// the LoanRegistry seam, and claim USDC on Arc. The privacy/underwriting story is told in the
/// "How it works" section above; this card is the live, on-chain action.
export function BorrowTab() {
  const { address, isConnected } = useAccount();

  const { data: terms, isLoading } = useReadContract({
    address: LOAN_REGISTRY,
    abi: loanRegistryAbi,
    functionName: "getTerms",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(LOAN_REGISTRY && address) },
  });

  const { writeContract, isPending, data: txHash, error } = useWriteContract();
  const approved = terms?.approved ?? false;

  return (
    <section className="card">
      <h2>Get your advance</h2>
      <ol className="flow">
        <li>
          <strong>1 · Verify you're a unique human</strong>
          <p className="muted">
            World ID mints one ERC-8004 passport per person — your reputation, bound to you, not your wallet.
          </p>
          <WorldIdVerify />
        </li>

        <li>
          <strong>2 · Your loan terms</strong>
          {!LOAN_REGISTRY ? (
            <p className="muted">Set the LoanRegistry address to read terms.</p>
          ) : !isConnected ? (
            <p className="muted">Connect your wallet to see your terms.</p>
          ) : isLoading ? (
            <p className="muted">Reading your terms from the seam…</p>
          ) : approved ? (
            <table className="terms">
              <tbody>
                <tr><td>Principal</td><td>{formatUnits(terms!.principal, 6)} USDC</td></tr>
                <tr><td>APR</td><td>{(terms!.aprBps / 100).toFixed(2)}%</td></tr>
                <tr><td>Risk band</td><td>{terms!.riskBand}</td></tr>
                <tr>
                  <td>Expires</td>
                  <td>{terms!.expiry ? new Date(Number(terms!.expiry) * 1000).toLocaleDateString() : "—"}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">No approved terms yet — a private check sets these once you're verified.</p>
          )}
        </li>

        <li>
          <strong>3 · Claim — USDC lands on Arc in seconds</strong>
          <div>
            <button
              className="btn btn--primary"
              style={{ marginTop: 12 }}
              disabled={!approved || !LOAN_VAULT || isPending}
              onClick={() =>
                LOAN_VAULT && writeContract({ address: LOAN_VAULT, abi: loanVaultAbi, functionName: "claim" })
              }
            >
              {isPending ? "Claiming…" : "Claim advance"}
            </button>
            {txHash && <p className="muted">tx: <code>{txHash}</code></p>}
            {error && <p className="error">{error.message}</p>}
          </div>
        </li>
      </ol>
    </section>
  );
}
