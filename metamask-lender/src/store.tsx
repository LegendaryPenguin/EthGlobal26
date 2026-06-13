import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import type { ChainId, TokenSymbol, TrancheId } from "./data/mock";

// ---- Routing model ---------------------------------------------------------
// Tabs map to MetaMask Portfolio nav. The Earn tab hosts the multi-step Vouch
// deposit flow (`step`). Source + amount are one combined Bridge-style step
// (matches the real MetaMask Bridge, where you pick asset and enter amount on
// one card). Deep links (?screen=) seed state so the screenshot harness can
// reach every screen without click-threading.

export type Tab = "tokens" | "stake" | "bridge" | "activity";
export type Step = "list" | "tranche" | "amount" | "review" | "success";
export type ModalKind = null | "approve" | "deposit" | "withdraw";

export interface Position {
  tranche: TrancheId;
  principal: number;
}

export const ARCSCAN_TX = "https://testnet.arcscan.app/tx/";

export interface ActivityLeg {
  id: string;
  title: string;
  sub: string;
  sim: boolean; // true = mocked/simulated leg; false = real on-chain
  href?: string; // Arcscan link for real txns
}

export interface State {
  locked: boolean;
  tab: Tab;
  step: Step;
  tranche: TrancheId;
  sourceChain: ChainId;
  sourceToken: TokenSymbol;
  amount: string;
  approved: boolean;
  modal: ModalKind;
  position: Position | null;
  activity: ActivityLeg[];
  live: boolean; // was the current position created by REAL on-chain txns?
  approveTx?: `0x${string}`;
  depositTx?: `0x${string}`;
  bridgeTx?: `0x${string}`; // Arc mint tx (CCTP receiveMessage) for the cross-chain path
}

const BASE: State = {
  locked: false,
  tab: "tokens",
  step: "list",
  tranche: 0,
  sourceChain: "arc",
  sourceToken: "USDC",
  amount: "",
  approved: false,
  modal: null,
  position: null,
  activity: [],
  live: false,
};

// Route line shown under the bridge selector (DESIGN_SPEC §5 Screen 4).
// USDC cross-chain is wired to REAL CCTP V2 (burn-and-mint); non-USDC would need a swap (mocked).
export function routeLine(chain: ChainId, token: TokenSymbol): string {
  if (chain === "arc" && token === "USDC") return "On Arc — no bridge needed";
  if (token === "USDC") return "via Circle CCTP V2 → Arc · burn-and-mint · Fast finality";
  return "Swap → via CCTP V2 → Arc · burn-and-mint · Fast finality";
}

export function isCrossChain(s: Pick<State, "sourceChain" | "sourceToken">): boolean {
  return s.sourceChain !== "arc" || s.sourceToken !== "USDC";
}

type Action =
  | { type: "tab"; tab: Tab }
  | { type: "step"; step: Step }
  | { type: "tranche"; tranche: TrancheId }
  | { type: "source"; chain: ChainId; token: TokenSymbol }
  | { type: "amount"; amount: string }
  | { type: "modal"; modal: ModalKind }
  | { type: "confirmApprove"; tx?: `0x${string}` }
  | { type: "confirmDeposit"; tx?: `0x${string}`; live?: boolean; bridgeTx?: `0x${string}` }
  | { type: "confirmWithdraw" }
  | { type: "startDeposit" }
  | { type: "unlock" }
  | { type: "reset" };

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function legsFor(s: State): ActivityLeg[] {
  const amt = `${fmt(Number(s.amount) || 0)} USDC`;
  const tname = s.tranche === 0 ? "Senior" : "Junior";
  const legs: ActivityLeg[] = [];
  // Cross-chain bridge leg — real (CCTP) when live, else simulated.
  if (isCrossChain(s)) {
    legs.push({
      id: "bridge",
      title: "Bridge to Arc",
      sub: routeLine(s.sourceChain, s.sourceToken),
      sim: !s.live,
      href: s.live && s.bridgeTx ? ARCSCAN_TX + s.bridgeTx : undefined,
    });
  }
  legs.push({
    id: "approve",
    title: "Approve USDC",
    sub: "Vouch TranchePool · Arc Testnet",
    sim: !s.live,
    href: s.live && s.approveTx ? ARCSCAN_TX + s.approveTx : undefined,
  });
  legs.push({
    id: "deposit",
    title: `Deposit to Vouch ${tname}`,
    sub: `${amt} · Arc Testnet`,
    sim: !s.live,
    href: s.live && s.depositTx ? ARCSCAN_TX + s.depositTx : undefined,
  });
  return legs;
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "tab":
      return { ...s, tab: a.tab };
    case "step":
      return { ...s, step: a.step };
    case "tranche":
      return { ...s, tranche: a.tranche };
    case "source":
      return { ...s, sourceChain: a.chain, sourceToken: a.token };
    case "amount":
      return { ...s, amount: a.amount };
    case "modal":
      // Guard: for the single-chain Arc path, deposit is unreachable until approval is done.
      // Cross-chain runs approve+deposit inside one bridge pipeline, so allow it directly.
      if (a.modal === "deposit" && !s.approved && !isCrossChain(s)) return { ...s, modal: "approve" };
      return { ...s, modal: a.modal };
    case "confirmApprove":
      return { ...s, approved: true, modal: null, approveTx: a.tx ?? s.approveTx };
    case "confirmDeposit": {
      const ns: State = { ...s, live: a.live ?? false, depositTx: a.tx, bridgeTx: a.bridgeTx };
      const position: Position = { tranche: s.tranche, principal: Number(s.amount) || 0 };
      return { ...ns, modal: null, step: "success", position, activity: legsFor(ns) };
    }
    case "confirmWithdraw":
      return { ...s, modal: null, position: null, activity: [], step: "list", tab: "tokens" };
    case "startDeposit":
      return { ...s, tab: "stake", step: "tranche", approved: false, amount: "", live: false, approveTx: undefined, depositTx: undefined };
    case "unlock":
      return { ...s, locked: false, tab: "tokens" };
    case "reset":
      return { ...BASE };
    default:
      return s;
  }
}

// Seed state from a ?screen= deep link (used by scripts/screenshot.mjs).
export function initStateFromScreen(): State {
  const screen = new URLSearchParams(window.location.search).get("screen");
  const filled: Position = { tranche: 0, principal: 1000 };
  const withLegs = (s: State) => ({ ...s, activity: legsFor(s) });
  switch (screen) {
    case "login":
      return { ...BASE, locked: true };
    case "overview":
      return { ...BASE, tab: "tokens" };
    case "earn":
      return { ...BASE, tab: "stake", step: "list" };
    case "tranche":
      return { ...BASE, tab: "stake", step: "tranche" };
    case "source":
    case "amount":
      return { ...BASE, tab: "stake", step: "amount", amount: "1000" };
    case "crosschain":
      // Exercise the cross-chain rail (Gateway route + bridge progress).
      return { ...BASE, tab: "stake", step: "amount", amount: "1000", sourceChain: "ethereum", sourceToken: "USDC" };
    case "review":
      return { ...BASE, tab: "stake", step: "review", amount: "1000" };
    case "confirm":
      // Deposit modal is only valid post-approval — seed approved=true.
      return { ...BASE, tab: "stake", step: "review", amount: "1000", approved: true, modal: "deposit" };
    case "confirm-cc":
      return { ...BASE, tab: "stake", step: "review", amount: "1000", approved: true, modal: "deposit", sourceChain: "ethereum", sourceToken: "USDC" };
    case "success":
      return withLegs({ ...BASE, tab: "stake", step: "success", amount: "1000", approved: true, position: filled });
    case "position":
      return withLegs({ ...BASE, tab: "tokens", amount: "1000", position: filled });
    case "activity":
      return withLegs({ ...BASE, tab: "activity", amount: "1000", position: filled });
    default:
      // First load (no deep link) opens on the MetaMask unlock screen.
      return { ...BASE, tab: "tokens", locked: true };
  }
}

const Ctx = createContext<{ state: State; dispatch: React.Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initStateFromScreen);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

export { fmt };
