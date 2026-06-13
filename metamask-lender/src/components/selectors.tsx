import { useMemo, useState } from "react";
import {
  CHAINS,
  SOURCE_BALANCES,
  TOKENS,
  type ChainId,
  type TokenSymbol,
} from "../data/mock";
import { ChainIcon, TokenIcon, TokenOnChain, Chevron, SearchIcon, CloseIcon } from "./Icons";

// Combined asset selector — one pill showing token (with chain badge) + symbol + caret,
// matching the real MetaMask Bridge. Opens a searchable token+network list. DESIGN_SPEC §3.6.
export function AssetSelector({
  token,
  chain,
  onChange,
  locked,
}: {
  token: TokenSymbol;
  chain: ChainId;
  onChange?: (t: TokenSymbol, c: ChainId) => void;
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return SOURCE_BALANCES.filter(
      (b) =>
        !ql ||
        b.token.toLowerCase().includes(ql) ||
        TOKENS[b.token].name.toLowerCase().includes(ql) ||
        CHAINS[b.chain].name.toLowerCase().includes(ql),
    );
  }, [q]);

  return (
    <>
      <button className={`asset-pill ${locked ? "is-locked" : ""}`} onClick={() => !locked && setOpen(true)} disabled={locked}>
        <TokenOnChain token={token} chain={chain} size={26} />
        <span className="asset-pill__sym t-body-md-bold">{token}</span>
        {!locked && <Chevron dir="down" size={14} color="var(--color-text-default)" />}
      </button>

      {open && (
        <div className="modal-scrim" onClick={() => setOpen(false)}>
          <div className="modal modal--token" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <span className="t-heading-sm">Select a token</span>
              <button className="iconbtn" onClick={() => setOpen(false)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
            <div className="search">
              <SearchIcon />
              <input
                autoFocus
                placeholder="Search name, token or paste address"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="toklist">
              {list.map((b) => (
                <button
                  key={`${b.token}-${b.chain}`}
                  className={`toklist__row ${b.token === token && b.chain === chain ? "is-active" : ""}`}
                  onClick={() => {
                    onChange?.(b.token, b.chain);
                    setOpen(false);
                  }}
                >
                  <span className="toklist__l">
                    <TokenOnChain token={b.token} chain={b.chain} size={34} />
                    <span className="toklist__meta">
                      <span className="t-body-md">{TOKENS[b.token].name}</span>
                      <span className="t-body-sm text-alt">
                        {b.token} · {CHAINS[b.chain].name}
                      </span>
                    </span>
                  </span>
                  <span className="toklist__r">
                    <span className="t-body-md-bold tabular">
                      {b.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                    </span>
                    <span className="t-body-sm text-alt tabular">
                      ${b.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </span>
                </button>
              ))}
              <div className="toklist__import t-body-sm text-alt">
                Can't find a token? Paste its address above to <span style={{ color: "var(--color-primary-default)" }}>Import</span>.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Compact network badge pill (used in the top bar). Non-interactive in the demo.
export function NetworkBadge({ chain }: { chain: ChainId }) {
  const c = CHAINS[chain];
  return (
    <span className="topnet">
      <ChainIcon chain={chain} size={18} />
      <span className="t-body-sm-medium">{c.name}</span>
      <Chevron dir="down" size={13} color="var(--color-text-alternative)" />
    </span>
  );
}

export function TokenIconLite({ symbol, size }: { symbol: TokenSymbol; size: number }) {
  return <TokenIcon symbol={symbol} size={size} />;
}

export function sourceBalanceOf(token: TokenSymbol, chain: ChainId): number {
  return SOURCE_BALANCES.find((b) => b.token === token && b.chain === chain)?.balance ?? 0;
}
