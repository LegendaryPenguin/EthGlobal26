# /scripts — deploy · seed-pool · demo runner

Operational glue. Where the three workstreams (Arc money, Chainlink decision, World/ZK + frontend)
converge alongside the `LoanRegistry` seam.

Planned scripts:
- **deploy** — Solidity deploys live in `contracts/script/Deploy.s.sol` (Foundry). This dir holds
  any TS orchestration around it (e.g. post-deploy `setForwarder`, env wiring).
- **seed-pool** — fund the `TranchePool` / `LoanVault` with testnet USDC from
  https://faucet.circle.com (USDC is 6 decimals — Golden Rule #4).
- **demo runner** — drive the ~3-minute demo (docs/07): borrow-with-invisible-income →
  defaulter-can't-respawn → money-moves-and-repays-itself.

Keep the cross-chain bridge step OFF the live critical path (Golden Rule #7).
