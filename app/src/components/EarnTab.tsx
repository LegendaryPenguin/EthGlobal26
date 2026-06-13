import { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { parseUnits, formatUnits, type Address } from "viem";
import { tranchePoolAbi, TRANCHE } from "../abis/tranchePool";
import { erc20Abi } from "../abis/passportRegistry";

const POOL = import.meta.env.VITE_TRANCHE_POOL_ADDRESS as Address | undefined;
const USDC = import.meta.env.VITE_USDC_ADDRESS as Address | undefined;

/// Lender "Earn" surface (docs/01 tranche math). Senior ~80% / ~6% fixed, first-loss-protected;
/// Junior ~20%, absorbs defaults first, takes residual interest (~26% in the worked example).
/// Cross-chain deposits arrive via Gateway / CCTP V2 (scripts/bridge-deposit.ts) — architect
/// cross-chain, demo single-chain on Arc (Golden Rule #7). USDC = 6 decimals.
export function EarnTab() {
  const { address, isConnected } = useAccount();
  const [tranche, setTranche] = useState<"Senior" | "Junior">("Senior");
  const [amount, setAmount] = useState("");
  const { writeContract, isPending, data: txHash, error } = useWriteContract();

  const trancheId = TRANCHE[tranche];
  const ready = Boolean(POOL && USDC && isConnected && address);
  const parsed = (() => {
    try {
      return parseUnits(amount || "0", 6);
    } catch {
      return 0n;
    }
  })();

  const { data: position } = useReadContract({
    address: POOL,
    abi: tranchePoolAbi,
    functionName: "assetsOf",
    args: address ? [address, trancheId] : undefined,
    query: { enabled: Boolean(POOL && address) },
  });

  const approve = () =>
    USDC &&
    POOL &&
    writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [POOL, parsed] });

  const deposit = () =>
    POOL &&
    writeContract({ address: POOL, abi: tranchePoolAbi, functionName: "deposit", args: [trancheId, parsed] });

  return (
    <section className="card">
      <h2>Earn — fund the pool</h2>
      <div className="tranche-toggle">
        <button
          className={tranche === "Senior" ? "tab tab--active" : "tab"}
          onClick={() => setTranche("Senior")}
        >
          Senior · ~6% APY · first-loss protected
        </button>
        <button
          className={tranche === "Junior" ? "tab tab--active" : "tab"}
          onClick={() => setTranche("Junior")}
        >
          Junior · ~26% APY · absorbs defaults first
        </button>
      </div>

      {POOL && address && (
        <p className="muted">
          Your {tranche} position: <strong>{formatUnits((position as bigint) ?? 0n, 6)} USDC</strong>
        </p>
      )}

      <label className="field">
        Deposit amount (USDC, 6 decimals)
        <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>

      <div className="walletbar">
        <button className="btn" disabled={!ready || isPending || parsed === 0n} onClick={approve}>
          1 · Approve pool
        </button>
        <button
          className="btn btn--primary"
          disabled={!ready || isPending || parsed === 0n}
          onClick={deposit}
        >
          2 · Deposit to {tranche}
        </button>
      </div>

      {!ready && <p className="muted">Set VITE_TRANCHE_POOL_ADDRESS + VITE_USDC_ADDRESS and connect a wallet.</p>}
      {txHash && <p className="muted">tx: {txHash}</p>}
      {error && <p className="error">{error.message}</p>}
      <p className="muted">
        Cross-chain deposits (any chain → Arc) use <code>scripts/bridge-deposit.ts</code> (CCTP V2) or
        Circle Gateway; the live demo runs natively on Arc.
      </p>
    </section>
  );
}
