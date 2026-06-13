import { useState, type ReactNode } from "react";
import { useStore, type Tab } from "../store";
import { MOCK_ACCOUNT } from "../data/mock";
import { FoxLogo, Blockie, Chevron, NavIcon, GearIcon } from "./Icons";
import { NetworkBadge } from "./selectors";
import { useWallet } from "../web3/useLender";

const NAV: { id: Tab; label: string; icon: "tokens" | "stake" | "bridge" | "activity" }[] = [
  { id: "tokens", label: "Tokens", icon: "tokens" },
  { id: "stake", label: "Earn", icon: "stake" },
  { id: "bridge", label: "Bridge", icon: "bridge" },
  { id: "activity", label: "Activity", icon: "activity" },
];

function TopBar() {
  const [open, setOpen] = useState(false);
  const { address, isConnected, disconnect } = useWallet();
  const shortAddr = isConnected && address ? `${address.slice(0, 6)}…${address.slice(-4)}` : MOCK_ACCOUNT.short;
  const fullAddr = isConnected && address ? address : MOCK_ACCOUNT.address;
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <FoxLogo size={30} />
        <span className="topbar__wordmark">MetaMask</span>
      </div>
      <div className="topbar__right">
        <NetworkBadge chain="arc" />
        <button className="iconbtn" aria-label="Settings"><GearIcon size={18} /></button>
        <div className="account-pill" onClick={() => setOpen((v) => !v)}>
          {isConnected && <span className="live-dot" title="Connected" />}
          <Blockie size={22} />
          <span className="t-body-sm-medium">{shortAddr}</span>
          <Chevron dir="down" size={14} color="var(--color-text-alternative)" />
          {open && (
            <div className="popover" onClick={(e) => e.stopPropagation()}>
              <div className="popover__acct">
                <Blockie size={28} />
                <div>
                  <div className="t-body-sm-medium">{isConnected ? "Connected" : "Account 1"}</div>
                  <div className="t-body-xs text-alt">{shortAddr}</div>
                </div>
              </div>
              <div className="t-body-xs text-alt" style={{ wordBreak: "break-all", marginTop: 8 }}>{fullAddr}</div>
              {isConnected ? (
                <button className="popover__copy t-body-sm-medium" onClick={() => disconnect()}>Disconnect</button>
              ) : (
                <button className="popover__copy t-body-sm-medium">Copy address</button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function Sidebar() {
  const { state, dispatch } = useStore();
  return (
    <nav className="sidebar">
      {NAV.map((n) => (
        <button
          key={n.id}
          className={`sidebar__item ${state.tab === n.id ? "is-active" : ""}`}
          onClick={() => dispatch({ type: "tab", tab: n.id })}
        >
          <NavIcon name={n.icon} size={20} />
          <span>{n.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <TopBar />
      <div className="shell__body">
        <Sidebar />
        <main className="main">
          <div className="main__col">{children}</div>
        </main>
      </div>
    </div>
  );
}
