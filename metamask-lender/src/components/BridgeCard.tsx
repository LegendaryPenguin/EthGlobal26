import { formatUnits } from "viem";
import { useStore, routeLine, isCrossChain } from "../store";
import { CHAINS } from "../data/mock";
import { AssetSelector, sourceBalanceOf } from "./selectors";
import { TokenOnChain, SwapVert, RouteIcon } from "./Icons";
import { useWallet, useUsdcBalance } from "../web3/useLender";

const grp = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Reused for the deposit amount step and the Bridge tab. DESIGN_SPEC §5.
export function BridgeCard({ mode }: { mode: "source" | "amount" }) {
  const { state, dispatch } = useStore();
  const { sourceChain, sourceToken, amount } = state;
  const { isConnected } = useWallet();
  // Live USDC balance when connected (only USDC is read on-chain); else mock fixture.
  const liveBal = useUsdcBalance(sourceChain);
  const bal =
    isConnected && sourceToken === "USDC" && liveBal !== undefined
      ? Number(formatUnits(liveBal, 6))
      : sourceBalanceOf(sourceToken, sourceChain);
  const amt = Number(amount) || 0;
  const isStable = sourceToken === "USDC" || sourceToken === "USDT" || sourceToken === "EURC";
  const rate = sourceToken === "ETH" ? 3000 : 1; // mock conversion to USDC
  const received = amt * rate;
  const payUsd = amt * (isStable ? 1 : rate);

  return (
    <div className="bridgecard">
      {/* You pay */}
      <div className="bcblock">
        <div className="bcblock__head">
          <span className="t-body-sm text-alt">You pay</span>
          <span className="bc-bal">
            <span className="t-body-sm text-alt tabular">
              Balance: {grp(bal)} {sourceToken}
            </span>
            {mode === "amount" && (
              <button className="max-link t-body-sm-medium" onClick={() => dispatch({ type: "amount", amount: String(bal) })}>
                Max
              </button>
            )}
          </span>
        </div>
        <div className="bcblock__main">
          {mode === "amount" ? (
            <input
              className="bc-amount"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => dispatch({ type: "amount", amount: e.target.value.replace(/[^0-9.]/g, "") })}
            />
          ) : (
            <span className="bc-amount bc-amount--placeholder">0</span>
          )}
          <AssetSelector token={sourceToken} chain={sourceChain} onChange={(t, c) => dispatch({ type: "source", chain: c, token: t })} />
        </div>
        <div className="bcblock__foot">
          <span className="t-body-sm text-alt tabular">≈ ${usd(payUsd)}</span>
          <span className="t-body-sm text-alt">{CHAINS[sourceChain].name}</span>
        </div>
      </div>

      {/* Flip (decorative, disabled — destination fixed) */}
      <div className="bc-flip">
        <span className="bc-flip__btn" aria-disabled title="Destination locked to Arc">
          <SwapVert size={16} />
        </span>
      </div>

      {/* You receive */}
      <div className="bcblock bcblock--receive">
        <div className="bcblock__head">
          <span className="t-body-sm text-alt">You receive</span>
          <span className="t-body-sm text-alt">Destination locked</span>
        </div>
        <div className="bcblock__main">
          <span className="bc-amount tabular">{mode === "amount" ? grp(received) : "0"}</span>
          <span className="asset-pill is-locked">
            <TokenOnChain token="USDC" chain="arc" size={26} />
            <span className="asset-pill__sym t-body-md-bold">USDC</span>
          </span>
        </div>
        <div className="bcblock__foot">
          <span className="t-body-sm text-alt tabular">≈ ${usd(received)}</span>
          <span className="t-body-sm text-alt">{CHAINS.arc.name}</span>
        </div>
      </div>

      {/* Route line */}
      <div className="routeline">
        <span className="routeline__icon"><RouteIcon size={15} /></span>
        <span className="t-body-sm text-alt">{routeLine(sourceChain, sourceToken)}</span>
      </div>

      {/* Cross-chain bridge quote (mirrors a real CCTP/Gateway quote) */}
      {isCrossChain(state) && (
        <div className="quote">
          <div className="quote__row">
            <span className="t-body-sm text-alt">Provider</span>
            <span className="t-body-sm-medium">Circle CCTP V2 · burn-and-mint</span>
          </div>
          <div className="quote__row">
            <span className="t-body-sm text-alt">Bridge fee</span>
            <span className="t-body-sm-medium tabular">≈ $0.02 (max)</span>
          </div>
          <div className="quote__row">
            <span className="t-body-sm text-alt">Arrives in</span>
            <span className="t-body-sm-medium">~15–30s · Fast finality</span>
          </div>
        </div>
      )}

      <p className="t-body-xs text-muted" style={{ margin: "10px 4px 0" }}>
        Destination: USDC on {CHAINS.arc.name} (chain {5042002}, 6 decimals). Gas paid in USDC — no top-up needed.
      </p>
    </div>
  );
}
