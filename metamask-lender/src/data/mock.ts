// All fixtures for the fully-mocked replica. No network, no wallet. (DESIGN_SPEC §5)

export type ChainId =
  | "ethereum"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "linea"
  | "avalanche"
  | "bnb"
  | "arc";

export interface Chain {
  id: ChainId;
  name: string;
  color: string;
  short: string;
  testnet?: boolean;
}

// Source chains a lender can fund from; Arc is the pinned destination. (DESIGN_SPEC §3.6)
export const CHAINS: Record<ChainId, Chain> = {
  ethereum: { id: "ethereum", name: "Ethereum", color: "#627EEA", short: "ETH" },
  base: { id: "base", name: "Base", color: "#0052FF", short: "BASE" },
  arbitrum: { id: "arbitrum", name: "Arbitrum", color: "#1B4ADD", short: "ARB" },
  optimism: { id: "optimism", name: "Optimism", color: "#FF0420", short: "OP" },
  polygon: { id: "polygon", name: "Polygon", color: "#8247E5", short: "POL" },
  linea: { id: "linea", name: "Linea", color: "#121212", short: "LINEA" },
  avalanche: { id: "avalanche", name: "Avalanche", color: "#E84142", short: "AVAX" },
  bnb: { id: "bnb", name: "BNB Chain", color: "#F3BA2F", short: "BNB" },
  arc: { id: "arc", name: "Arc Testnet", color: "#1F9E8E", short: "ARC", testnet: true },
};

export const SOURCE_CHAINS: ChainId[] = [
  "arc",
  "ethereum",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "linea",
  "avalanche",
  "bnb",
];

export type TokenSymbol = "USDC" | "USDT" | "ETH" | "DAI" | "EURC";

export interface Token {
  symbol: TokenSymbol;
  name: string;
  color: string;
  decimals: number;
}

export const TOKENS: Record<TokenSymbol, Token> = {
  USDC: { symbol: "USDC", name: "USD Coin", color: "#2775CA", decimals: 6 },
  USDT: { symbol: "USDT", name: "Tether USD", color: "#26A17B", decimals: 6 },
  EURC: { symbol: "EURC", name: "Euro Coin", color: "#2775CA", decimals: 6 },
  DAI: { symbol: "DAI", name: "Dai", color: "#F5AC37", decimals: 18 },
  ETH: { symbol: "ETH", name: "Ethereum", color: "#627EEA", decimals: 18 },
};

// Tokens selectable in the "You pay" selector, with mock per-chain balances.
export interface SourceBalance {
  token: TokenSymbol;
  chain: ChainId;
  balance: number; // human units
  usd: number;
}

export const SOURCE_BALANCES: SourceBalance[] = [
  { token: "USDC", chain: "arc", balance: 3500, usd: 3500 },
  { token: "USDC", chain: "ethereum", balance: 2500, usd: 2500 },
  { token: "USDC", chain: "base", balance: 1000, usd: 1000 },
  { token: "USDT", chain: "arbitrum", balance: 800, usd: 800.16 },
  { token: "ETH", chain: "ethereum", balance: 0.42, usd: 1260 },
  { token: "DAI", chain: "polygon", balance: 420, usd: 420.1 },
];

// Portfolio home token rows (DESIGN_SPEC §5 Screen 1). USDC aggregates across chains
// into one row with a multi-network badge, mirroring the real Portfolio.
export interface PortfolioRow {
  token: TokenSymbol;
  networks: ChainId[];
  balance: string;
  price: string;
  usd: string;
  change: string; // signed %, with leading + or -
  up: boolean;
}

export const PORTFOLIO_ROWS: PortfolioRow[] = [
  { token: "USDC", networks: ["ethereum", "base", "arc"], balance: "7,000.00 USDC", price: "$1.00", usd: "$7,000.00", change: "+0.01%", up: true },
  { token: "ETH", networks: ["ethereum"], balance: "0.42 ETH", price: "$3,000.00", usd: "$1,260.00", change: "+1.2%", up: true },
];

// Vouch product (the real entry inside Earn). (DESIGN_SPEC §5 Screen 2)
export const VOUCH = {
  name: "Vouch — Credit Passport",
  asset: "USDC" as TokenSymbol,
  apyRange: "6% – 26% APY",
  tag: "Credit Passport · real-income-backed",
  utilization: "Pool utilization 72% · TVL $4.2M",
  subtext: "Yield from undercollateralized loans to verified humans.",
};

export type TrancheId = 0 | 1;
export interface Tranche {
  id: TrancheId;
  name: string;
  apy: number; // decimal, e.g. 0.06
  apyLabel: string;
  blurb: string;
  share: string;
  pill: string;
}

export const TRANCHES: Record<TrancheId, Tranche> = {
  0: {
    id: 0,
    name: "Senior",
    apy: 0.06,
    apyLabel: "~6% APY",
    blurb: "First-loss protected · passive · paid before Junior",
    share: "~80% of pool",
    pill: "Senior · first-loss protected",
  },
  1: {
    id: 1,
    name: "Junior",
    apy: 0.26,
    apyLabel: "~26% APY",
    blurb: "Absorbs defaults first · higher risk",
    share: "~20% of pool",
    pill: "Junior · absorbs defaults first",
  },
};

// Decorative native-staking options shown alongside Vouch. (DESIGN_SPEC §5 Screen 2)
// MetaMask's own pooled staking reads as live; third-party providers are "Coming soon".
export const STAKING_PROVIDERS: {
  name: string; asset: string; apr: string; note: string; kind: "metamask" | "lido" | "rocket"; live: boolean;
}[] = [
  { name: "MetaMask Pooled Staking", asset: "ETH", apr: "3.2% APR", note: "Network control · Popularity", kind: "metamask", live: true },
  { name: "Lido", asset: "ETH", apr: "3.0% APR", note: "Liquid staking", kind: "lido", live: false },
  { name: "Rocket Pool", asset: "ETH", apr: "2.9% APR", note: "Liquid staking", kind: "rocket", live: false },
];

export const PROVIDER_COLORS: Record<string, string> = {
  lido: "#00A3FF",
  rocket: "#F5A623",
};

export const MOCK_ACCOUNT = {
  address: "0x7555Ed0287b22C44b5efA4598bA22593745Bf014",
  short: "0x7555…F014",
};

export const ARC = { chainId: 5042002, name: "Arc Testnet" };
