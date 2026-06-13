import { useEffect, useState } from "react";
import { useStore, fmt, isCrossChain } from "../store";
import { TRANCHES, MOCK_ACCOUNT, ARC, CHAINS } from "../data/mock";
import { Button } from "./ui";
import { Blockie, CheckCircle, Spinner, CloseIcon } from "./Icons";
import { useWallet, useArcDeposit } from "../web3/useLender";
import { useCctpDeposit } from "../web3/useCctpDeposit";
import { WAGMI_CHAIN_ID } from "../web3/contracts";

function humanError(e: unknown): string {
  const any = e as { shortMessage?: string; details?: string; message?: string };
  const msg = any?.shortMessage || any?.details || any?.message || "Transaction failed";
  return msg.length > 160 ? msg.slice(0, 160) + "…" : msg;
}

// MetaMask-style confirmation. REAL on-chain txns when connected:
//  - Arc single-chain: approve + deposit.
//  - Cross-chain (USDC on Base/Eth Sepolia): full CCTP V2 burn -> attest -> mint -> deposit.
// Falls back to a faithful mock when not connected / unsupported source. DESIGN_SPEC §5 Screen 7.
export function ConfirmModal() {
  const { state, dispatch } = useStore();
  const { isConnected, address } = useWallet();
  const arc = useArcDeposit();
  const cctp = useCctpDeposit();

  const open = state.modal !== null;
  const kind = state.modal; // 'approve' | 'deposit' | 'withdraw'
  const t = TRANCHES[state.tranche];
  const amt = Number(state.amount) || 0;
  const principal = state.position?.principal ?? amt;
  const crossChain = isCrossChain(state);
  const srcName = CHAINS[state.sourceChain].name;

  // Real on-chain paths.
  const liveArc = isConnected && !crossChain && (kind === "approve" || kind === "deposit");
  const liveCross =
    isConnected &&
    crossChain &&
    kind === "deposit" &&
    state.sourceToken === "USDC" &&
    WAGMI_CHAIN_ID[state.sourceChain] !== undefined;
  const anyLive = liveArc || liveCross;

  const title =
    kind === "approve" ? "Spending cap request" : kind === "withdraw" ? "Withdrawal request" : "Transaction request";

  const legs =
    kind === "deposit"
      ? crossChain
        ? [`Burn on ${srcName}`, "Circle attestation", "Mint on Arc", "Approve + deposit on Arc"]
        : ["Submit deposit", "Confirmed on Arc"]
      : [];

  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(0);
  const [tick, setTick] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      setDone(0);
      setTick("");
      setError(null);
    }
  }, [open]);

  // Mock progression (skipped when a real txn is running).
  useEffect(() => {
    if (!confirming || anyLive) return;
    if (kind === "approve") {
      const id = setTimeout(() => dispatch({ type: "confirmApprove" }), 700);
      return () => clearTimeout(id);
    }
    if (kind === "withdraw") {
      const id = setTimeout(() => dispatch({ type: "confirmWithdraw" }), 900);
      return () => clearTimeout(id);
    }
    if (done >= legs.length) {
      const id = setTimeout(() => dispatch({ type: "confirmDeposit" }), 500);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setDone((d) => d + 1), 800);
    return () => clearTimeout(id);
  }, [confirming, done, kind, legs.length, anyLive, dispatch]);

  if (!open) return null;

  const headShort = isConnected && address ? `${address.slice(0, 6)}…${address.slice(-4)}` : MOCK_ACCOUNT.short;

  const onConfirm = async () => {
    setError(null);
    setConfirming(true);
    if (liveArc) {
      try {
        if (kind === "approve") {
          const tx = await arc.approve(state.amount);
          dispatch({ type: "confirmApprove", tx });
        } else {
          const tx = await arc.deposit(state.tranche, state.amount);
          dispatch({ type: "confirmDeposit", tx, live: true });
        }
      } catch (e) {
        setError(humanError(e));
        setConfirming(false);
      }
      return;
    }
    if (liveCross) {
      try {
        const r = await cctp.run({
          source: state.sourceChain,
          amount: state.amount,
          tranche: state.tranche,
          address: address as `0x${string}`,
          onStep: (d) => setDone(d),
          onTick: (m) => setTick(m),
        });
        dispatch({ type: "confirmDeposit", tx: r.depositTx, live: true, bridgeTx: r.mintTx });
      } catch (e) {
        setError(humanError(e));
        setConfirming(false);
      }
      return;
    }
    // else: mock effect drives it
  };

  const showLegs = kind === "deposit" && confirming && (crossChain || !liveArc);

  return (
    <div className="modal-scrim">
      <div className="modal modal--wallet" onClick={(e) => e.stopPropagation()}>
        <div className="wallet-head">
          <span className="net-badge t-body-2xs">
            <span className="net-badge__dot" style={{ background: CHAINS.arc.color }} /> {ARC.name}
          </span>
          <span className="wallet-acct">
            {isConnected && <span className="live-dot" />} <Blockie size={20} /> <span className="t-body-sm-medium">{headShort}</span>
          </span>
          {!confirming && (
            <button className="iconbtn" aria-label="Close" onClick={() => dispatch({ type: "modal", modal: null })}>
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="wallet-body">
          <div className="wallet-title t-heading-sm">{title}</div>

          <div className="wallet-origin">
            <span className="globe" />
            <span className="t-body-sm">portfolio.metamask.io</span>
            {anyLive && <span className="live-tag t-body-2xs">{liveCross ? "LIVE · CCTP" : "LIVE · Arc"}</span>}
          </div>

          <div className="changes">
            <div className="changes__label t-body-xs text-alt">Estimated changes</div>
            {kind === "approve" && (
              <div className="changes__row">
                <span className="t-body-sm">Spending cap</span>
                <span className="t-body-sm-medium tabular">{fmt(amt)} USDC</span>
              </div>
            )}
            {kind === "deposit" && (
              <div className="changes__row">
                <span className="t-body-sm">You send</span>
                <span className="t-body-sm-medium tabular changes__neg">- {fmt(amt)} USDC {crossChain ? `(from ${srcName})` : ""}</span>
              </div>
            )}
            {kind === "withdraw" && (
              <div className="changes__row">
                <span className="t-body-sm">You receive</span>
                <span className="t-body-sm-medium tabular changes__pos">+ {fmt(principal)} USDC</span>
              </div>
            )}
            <div className="changes__row">
              <span className="t-body-sm">To</span>
              <span className="t-body-sm-medium">{kind === "withdraw" ? headShort : `Vouch ${t.name} pool`}</span>
            </div>
          </div>

          <div className="fee-row">
            <span className="t-body-sm">Network fee</span>
            <span className="t-body-sm-medium tabular">~$0.01 USDC</span>
          </div>

          {confirming && liveArc && (
            <div className="progress">
              <div className="progress__step is-active">
                <Spinner size={18} />
                <span className="t-body-sm">Confirm in MetaMask…</span>
              </div>
            </div>
          )}

          {showLegs && (
            <div className="progress">
              <div className="t-body-sm-medium" style={{ marginBottom: 8 }}>
                {crossChain ? (liveCross ? "Bridging via CCTP V2…" : "Bridging in progress") : "Submitting"}
              </div>
              {legs.map((l, i) => (
                <div key={l} className={`progress__step ${i < done ? "is-done" : i === done ? "is-active" : ""}`}>
                  {i < done ? <CheckCircle size={18} /> : i === done ? <Spinner size={18} /> : <span className="progress__dot" />}
                  <span className="t-body-sm">{l}</span>
                </div>
              ))}
              {liveCross && tick && <div className="t-body-2xs text-muted" style={{ marginTop: 6 }}>{tick}</div>}
            </div>
          )}

          {error && <p className="t-body-xs text-error" style={{ marginTop: 12 }}>{error}</p>}
        </div>

        <div className="wallet-foot">
          <Button variant="secondary" full disabled={confirming} onClick={() => dispatch({ type: "modal", modal: null })}>
            Cancel
          </Button>
          <Button full disabled={confirming} onClick={onConfirm}>
            {confirming ? "Confirming…" : crossChain && kind === "deposit" ? "Bridge & Deposit" : "Confirm"}
          </Button>
        </div>

        <div className="wallet-note t-body-2xs text-muted">
          {liveCross
            ? "Live CCTP V2 bridge + deposit. Expect ~3 MetaMask signatures and a short attestation wait."
            : anyLive
            ? "Live transaction on Arc — gas paid in USDC."
            : "Gas paid in USDC natively on Arc — no gas-token top-up needed."}
        </div>
      </div>
    </div>
  );
}
