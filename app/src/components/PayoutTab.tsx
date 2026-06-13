import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { parseUnits, type Address } from "viem";
import { incomeRouterAbi, erc20Abi } from "../abis/passportRegistry";

const INCOME_ROUTER = import.meta.env.VITE_INCOME_ROUTER_ADDRESS as Address | undefined;
const USDC = import.meta.env.VITE_USDC_ADDRESS as Address | undefined;

/// Mock creator-payout dashboard (docs/06 Stage 7) — demo money-shot #3. The router pulls the
/// payout from msg.sender via transferFrom, so we APPROVE the router for the amount first, then
/// call onPayout. It splits: repayment slice → LoanVault, remainder → borrower. USDC = 6 decimals.
export function PayoutTab() {
  const { address, isConnected } = useAccount();
  const [payout, setPayout] = useState("900");
  const { writeContract, isPending, data: txHash, error } = useWriteContract();

  const ready = Boolean(INCOME_ROUTER && USDC && isConnected && address);
  const amount = (() => {
    try {
      return parseUnits(payout || "0", 6);
    } catch {
      return 0n;
    }
  })();

  const approve = () =>
    USDC &&
    INCOME_ROUTER &&
    writeContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "approve",
      args: [INCOME_ROUTER, amount],
    });

  const cashOut = () =>
    INCOME_ROUTER &&
    address &&
    writeContract({
      address: INCOME_ROUTER,
      abi: incomeRouterAbi,
      functionName: "onPayout",
      args: [address, amount], // demo: the connected wallet is both payer and borrower
    });

  return (
    <section className="card">
      <h2>Creator payout (mock)</h2>
      <p className="muted">
        Simulates Tunde's platform paying out. Approve the router, then "Cash out" calls{" "}
        <code>IncomeRouter.onPayout</code>, which auto-routes the repayment slice to the loan before
        the rest reaches the borrower.
      </p>

      <label className="field">
        Incoming payout (USDC)
        <input inputMode="decimal" value={payout} onChange={(e) => setPayout(e.target.value)} />
      </label>

      <div className="walletbar">
        <button className="btn" disabled={!ready || isPending || amount === 0n} onClick={approve}>
          1 · Approve router
        </button>
        <button
          className="btn btn--primary"
          disabled={!ready || isPending || amount === 0n}
          onClick={cashOut}
        >
          2 · Cash out
        </button>
      </div>

      {!ready && (
        <p className="muted">Set VITE_INCOME_ROUTER_ADDRESS + VITE_USDC_ADDRESS and connect a wallet.</p>
      )}
      {txHash && <p className="muted">tx: {txHash}</p>}
      {error && <p className="error">{error.message}</p>}
    </section>
  );
}
