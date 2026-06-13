# /app — Frontend (borrower app · lender "Earn" · mock payout dashboard)

Stage 7. Three surfaces, two money-shots fire on **real contract calls**:

- **Borrower app** — apply → World ID (IDKit) verify → Noir proof in-browser → approved → claim →
  repayment status.
- **Lender "Earn"** — pick Senior/Junior, deposit (any chain → Arc via Gateway/CCTP V2), see
  position, withdraw.
- **Mock creator-payout dashboard** — a "cash out" button that really calls
  `IncomeRouter.onPayout` and shows the split (slice → loan, rest → borrower). Demo money-shot #3.

## Notes
- Chain interaction via **viem/wagmi**. Arc testnet (chain id 5042002) is supported by viem by
  default — just verify the chain id (Golden Rule #3).
- World ID verification must be validated **on-chain** (in `PassportRegistry`), not client-only.
- Architect cross-chain, **demo single-chain** (Golden Rule #7): show the cross-chain deposit with
  a pre-funded wallet or a short clip; keep the bridge off the live critical path.
- Read the relevant **Circle skill** before writing Circle code (`use-circle-wallets`, `use-usdc`,
  `use-gateway`).

## Links
- World ID: https://docs.world.org/world-id/overview · IDKit example: https://idkit-js-example.vercel.app/
- Circle Wallets: https://developers.circle.com/wallets
