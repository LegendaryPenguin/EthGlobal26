import { useState } from "react";
import { createPublicClient, http, defineChain, numberToHex, type Address, type Hex } from "viem";
import { logEvent, arcTx } from "../devlog";

const RPC = (import.meta.env.VITE_ARC_RPC_URL as string) || "https://rpc.testnet.arc.network";
const WALLET_LINK = ((import.meta.env.VITE_WALLET_LINK_ADDRESS as string) || "0x263999c1A58a37dc4554689Fa76eC4adc0429b0e") as Address;
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

const arc = defineChain({ id: 5042002, name: "arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const WALLET_LINK_ABI = [
  { type: "function", name: "worldIdOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32" }] },
] as const;

type State =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "checking"; wallet: string }
  | { kind: "free"; wallet: string }
  | { kind: "linkedHere"; wallet: string }
  | { kind: "linkedElsewhere"; wallet: string; worldId: string }
  | { kind: "linking"; wallet: string }
  | { kind: "linkedNow"; wallet: string; tx?: string }
  | { kind: "error"; message: string };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/// Connect-wallet anti-Sybil binding. Connects MetaMask, reads the on-chain WalletLink registry on
/// Arc, and shows whether the wallet is already bound to a World ID. A wallet tied to one human can't
/// be attached to a different World ID — proves the "one human, can't escape with a new wallet" thesis
/// live for the judges. `sessionNullifier` is the currently-verified human.
export function WalletLinkPanel({ sessionNullifier }: { sessionNullifier: string }) {
  const [s, setS] = useState<State>({ kind: "idle" });
  const sessionWorldId = numberToHex(BigInt(sessionNullifier), { size: 32 }).toLowerCase();

  const connect = async () => {
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
    if (!eth) { setS({ kind: "error", message: "No wallet found. Install MetaMask to link a wallet." }); return; }
    setS({ kind: "connecting" });
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const wallet = accounts?.[0];
      if (!wallet) throw new Error("no account");
      setS({ kind: "checking", wallet });
      const pub = createPublicClient({ chain: arc, transport: http(RPC) });
      const existing = (await pub.readContract({ address: WALLET_LINK, abi: WALLET_LINK_ABI, functionName: "worldIdOf", args: [wallet as Address] })) as Hex;
      if (existing === ZERO) setS({ kind: "free", wallet });
      else if (existing.toLowerCase() === sessionWorldId) setS({ kind: "linkedHere", wallet });
      else setS({ kind: "linkedElsewhere", wallet, worldId: existing });
    } catch (e) {
      setS({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const linkNow = async (wallet: string) => {
    setS({ kind: "linking", wallet });
    try {
      const r = (await (await fetch("/api/world/link-wallet", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionNullifier, wallet }),
      })).json()) as { ok: boolean; alreadyLinked?: boolean; sameHuman?: boolean; txHash?: string; detail?: string; linkedWorldId?: string };
      if (r.ok) {
        logEvent({ kind: "tx", label: "Wallet linked to World ID on Arc", value: r.txHash, link: arcTx(r.txHash) });
        setS({ kind: "linkedNow", wallet, tx: r.txHash });
      } else if (r.alreadyLinked) {
        setS({ kind: "linkedElsewhere", wallet, worldId: r.linkedWorldId ?? "0x" });
      } else {
        setS({ kind: "error", message: r.detail ?? "could not link wallet" });
      }
    } catch (e) {
      setS({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="passport-card" style={{ marginTop: 16 }}>
      <strong>🔗 Link a wallet (anti-Sybil)</strong>
      <p className="muted" style={{ marginTop: 4, marginBottom: 10 }}>
        One wallet ↔ one human. A wallet already tied to a World ID can't be attached to another —
        enforced on-chain on Arc.
      </p>

      {(s.kind === "idle" || s.kind === "error") && (
        <button className="btn" onClick={connect}>Connect wallet</button>
      )}
      {(s.kind === "connecting" || s.kind === "checking") && <p className="muted">Checking the wallet on Arc…</p>}

      {s.kind === "free" && (
        <>
          <p className="muted">Wallet <code>{short(s.wallet)}</code> is <strong>not yet linked</strong>.</p>
          <button className="btn btn--primary" style={{ marginTop: 8 }} onClick={() => linkNow(s.wallet)}>Link to this World ID</button>
        </>
      )}
      {s.kind === "linking" && <p className="muted">Linking on Arc…</p>}
      {s.kind === "linkedHere" && (
        <p className="zk-verdict zk-verdict--ok">✓ <code>{short(s.wallet)}</code> is linked to this World ID.</p>
      )}
      {s.kind === "linkedNow" && (
        <p className="zk-verdict zk-verdict--ok">
          ✓ Linked <code>{short(s.wallet)}</code> to your World ID on Arc.{" "}
          {s.tx && <a className="tlink" href={arcTx(s.tx)} target="_blank" rel="noreferrer">tx ↗</a>}
        </p>
      )}
      {s.kind === "linkedElsewhere" && (
        <p className="zk-verdict zk-verdict--bad">
          ⚠️ <code>{short(s.wallet)}</code> is already associated with a <strong>different World ID</strong>.
          It can't be linked again — one human, one identity.
        </p>
      )}
      {s.kind === "error" && <p className="error" style={{ marginTop: 8 }}>{s.message}</p>}
    </div>
  );
}
