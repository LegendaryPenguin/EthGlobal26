import { WalletBar } from "./components/WalletBar";
import { BorrowTab } from "./components/BorrowTab";

/// Single-surface app: the borrower flow (World ID → terms → claim). The Earn (lender) and Payout
/// surfaces were removed; the tranche/router contracts still exist on-chain for the demo scripts.
export function App() {
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

      <main className="main">
        <BorrowTab />
      </main>

      <footer className="footer">
        Arc Testnet · chain id 5042002 · testnet only. Gas is paid in USDC.
      </footer>
    </div>
  );
}
