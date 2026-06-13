import { CHAINS, TOKENS, type ChainId, type TokenSymbol } from "../data/mock";

// Real MetaMask fox mark (bundled asset in public/). Used in the top bar + provider chip.
export function FoxLogo({ size = 30 }: { size?: number }) {
  return <img src="/metamask.png" width={size} height={size} alt="MetaMask" style={{ display: "block", objectFit: "contain" }} />;
}

// ---- Token logos (brand colour + recognizable white glyph) ----
function TokenGlyph({ symbol, size }: { symbol: TokenSymbol; size: number }) {
  if (symbol === "ETH") {
    return (
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 2l6 10-6 3.5L6 12 12 2z" fill="#fff" />
        <path d="M12 16.8L18 13.3 12 22 6 13.3l6 3.5z" fill="#fff" opacity="0.75" />
      </svg>
    );
  }
  if (symbol === "USDC" || symbol === "EURC") {
    // Stylised USDC "C with $" mark.
    return (
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M14.5 7.2A5.2 5.2 0 0 0 7 12a5.2 5.2 0 0 0 7.5 4.8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <rect x="11.1" y="5.2" width="1.7" height="13.6" rx="0.8" fill="#fff" />
        <text x="12" y="15.4" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fff" fontFamily="Roboto, sans-serif">{symbol === "EURC" ? "€" : "$"}</text>
      </svg>
    );
  }
  // generic stable / DAI
  const g = symbol === "USDT" ? "₮" : symbol === "DAI" ? "◈" : "$";
  return (
    <span style={{ color: "#fff", fontWeight: 700, fontSize: size * 0.5, lineHeight: 1 }}>{g}</span>
  );
}

export function TokenIcon({ symbol, size = 32 }: { symbol: TokenSymbol; size?: number }) {
  const t = TOKENS[symbol];
  return (
    <span
      style={{
        width: size, height: size, borderRadius: "50%", background: t.color,
        display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none",
      }}
      aria-label={symbol}
    >
      <TokenGlyph symbol={symbol} size={size} />
    </span>
  );
}

// ---- Chain logos (brand colour + distinct white glyph) ----
function ChainGlyph({ chain, size }: { chain: ChainId; size: number }) {
  const s = size * 0.62;
  switch (chain) {
    case "ethereum":
    case "arbitrum":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 3l6 9.2-6 3.4-6-3.4L12 3z" fill="#fff" />
          <path d="M12 16.6l6-3.4L12 21l-6-7.8 6 3.4z" fill="#fff" opacity="0.7" />
        </svg>
      );
    case "base":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 21a9 9 0 1 0-9-9h11.4" stroke="#fff" strokeWidth="2.4" fill="none" />
        </svg>
      );
    case "optimism":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="8.5" cy="12" r="3.2" stroke="#fff" strokeWidth="2" />
          <circle cx="15.5" cy="12" r="3.2" stroke="#fff" strokeWidth="2" />
        </svg>
      );
    case "polygon":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 4l7 4v8l-7 4-7-4V8l7-4z" stroke="#fff" strokeWidth="1.8" fill="none" />
        </svg>
      );
    case "avalanche":
      return <span style={{ color: "#fff", fontWeight: 800, fontSize: size * 0.5, lineHeight: 1 }}>A</span>;
    case "bnb":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 5l2.5 2.5L12 10 9.5 7.5 12 5zm-5 5l2.5 2.5L7 20l-2.5-2.5L7 10zm10 0l2.5 2.5L17 20l-2.5-2.5L17 10zm-5 4l2.5 2.5L12 19l-2.5-2.5L12 14z" fill="#fff" />
        </svg>
      );
    case "arc":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="6.5" stroke="#fff" strokeWidth="2" />
          <circle cx="12" cy="12" r="2.2" fill="#fff" />
        </svg>
      );
    default:
      return <span style={{ color: "#fff", fontWeight: 700, fontSize: size * 0.5, lineHeight: 1 }}>{CHAINS[chain].short.slice(0, 1)}</span>;
  }
}

export function ChainIcon({ chain, size = 18 }: { chain: ChainId; size?: number }) {
  const c = CHAINS[chain];
  return (
    <span
      style={{
        width: size, height: size, borderRadius: "50%", background: c.color, color: "#fff",
        display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none",
        border: "1.5px solid #fff",
      }}
      aria-label={c.name}
    >
      <ChainGlyph chain={chain} size={size} />
    </span>
  );
}

// Token icon with a chain badge overlaid (portfolio rows / selectors).
export function TokenOnChain({ token, chain, size = 36 }: { token: TokenSymbol; chain: ChainId; size?: number }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
      <TokenIcon symbol={token} size={size} />
      <span style={{ position: "absolute", right: -3, bottom: -3 }}>
        <ChainIcon chain={chain} size={size * 0.46} />
      </span>
    </span>
  );
}

// Jazzicon-style identicon — gradient disc with a couple of offset shapes.
export function Blockie({ size = 24 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", display: "inline-block", flex: "none" }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" fill="#3B5BDB" />
        <rect x="6" y="-4" width="22" height="22" transform="rotate(28 16 16)" fill="#FF5C16" />
        <rect x="2" y="18" width="20" height="20" transform="rotate(-18 16 16)" fill="#1F9E8E" opacity="0.92" />
        <circle cx="22" cy="9" r="6" fill="#8B99FF" opacity="0.85" />
      </svg>
    </span>
  );
}

export function Chevron({ dir = "right", size = 16, color = "currentColor" }: { dir?: "right" | "down" | "left"; size?: number; color?: string }) {
  const rot = dir === "down" ? 90 : dir === "left" ? 180 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ transform: `rotate(${rot}deg)`, flex: "none" }} aria-hidden>
      <path d="M6 3l5 5-5 5" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckCircle({ size = 20, color = "var(--color-success-default)", halo = false }: { size?: number; color?: string; halo?: boolean }) {
  if (halo) {
    return (
      <span style={{ width: size * 1.7, height: size * 1.7, borderRadius: "50%", background: "var(--color-success-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <CheckCircle size={size} color={color} />
      </span>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" fill={color} />
      <path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="mm-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="var(--color-border-muted)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--color-primary-default)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function SwapVert({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M5 2v9M5 11L2.5 8.5M5 11l2.5-2.5M11 14V5M11 5L8.5 7.5M11 5l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RouteIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="3.5" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12.5" cy="3.5" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.2 11.2C8 9 10 7 10.8 5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="1 2" />
    </svg>
  );
}

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function GearIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2.5l1.3 2.2 2.5-.4.6 2.5 2.3 1-.9 2.4.9 2.4-2.3 1-.6 2.5-2.5-.4L12 21.5l-1.3-2.2-2.5.4-.6-2.5-2.3-1 .9-2.4-.9-2.4 2.3-1 .6-2.5 2.5.4L12 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

// MetaMask-style sidebar nav glyphs.
export function NavIcon({ name, size = 20 }: { name: "tokens" | "stake" | "bridge" | "activity"; size?: number }) {
  const s = { width: size, height: size, flex: "none" as const };
  switch (name) {
    case "tokens": // stacked coins
      return (
        <svg {...s} viewBox="0 0 24 24" fill="none" aria-hidden>
          <ellipse cx="12" cy="6.5" rx="7" ry="3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "stake": // plant / growth
      return (
        <svg {...s} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 21v-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M12 13c0-3-2.5-5-6-5 0 3 2.5 5 6 5zM12 11c0-2.5 2.2-4.5 5.5-4.5C17.5 9 15.3 11 12 11z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case "bridge":
      return (
        <svg {...s} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M3 16V11a4 4 0 0 1 8 0M21 16V11a4 4 0 0 0-8 0M2 16h20M5 16v3M19 16v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "activity": // clock
      return (
        <svg {...s} viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}
