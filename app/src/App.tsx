import { useState } from "react";
import { WalletBar } from "./components/WalletBar";
import { BorrowTab } from "./components/BorrowTab";
import { EarnTab } from "./components/EarnTab";
import { PayoutTab } from "./components/PayoutTab";

type Tab = "borrow" | "earn" | "payout";

const TABS: { id: Tab; label: string }[] = [
  { id: "borrow", label: "Borrow" },
  { id: "earn", label: "Earn" },
  { id: "payout", label: "Payout" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("borrow");

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Vouch</h1>
          <p className="tagline">
            Personhood is the collateral · the underwriting is private · the dollars move on Arc
          </p>
        </div>
        <WalletBar />
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={t.id === tab ? "tab tab--active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === "borrow" && <BorrowTab />}
        {tab === "earn" && <EarnTab />}
        {tab === "payout" && <PayoutTab />}
      </main>

      <footer className="footer">
        Arc Testnet · chain id 5042002 · testnet only. Gas is paid in USDC.
      </footer>
    </div>
  );
}
