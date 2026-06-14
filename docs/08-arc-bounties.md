# Vouch on Arc — Circle bounty submissions

Two tracks, one app. Vouch is an undercollateralized credit protocol where **personhood is the
collateral, underwriting is private, and the dollars move on Arc in USDC.** This doc covers the two
Circle/Arc bounties and how each requirement is met, with the live on-chain evidence.

---

## Deployed on Arc Testnet (chain 5042002)

| Contract | Address |
|---|---|
| MarketRateEngine (dynamic rate/yield) | `0x74D8d8BFBDcdDaf888e1f745f071afFB566919dB` |
| LoanVault (USDC disbursement pool) | `0x201f032252ca717952b8e980d580717325a57f16` |
| LoanRegistry (the terms seam) | `0x07f7123461a5b1ca489587ae6fed6fada60b2331` |
| PassportRegistry (ERC-8004) | `0xe9153228d7af221558685f6a70fe4f173cf2c7b0` |
| TranchePool (lender capital) | `0x73bfc359df81c897ee7c04c778c2491ccb53f4d7` |
| IncomeRouter (repayment) | `0x54dc0d8d4aa50c6070cba758595e7f59957bf534` |
| USDC (Arc native + ERC-20, 6dp) | `0x3600000000000000000000000000000000000000` |

Apps: **borrower** `vouch-borrower.vercel.app` · **lender** `vouch-lender.vercel.app`

---

## Track 1 — Best Smart Contracts on Arc (advanced stablecoin logic)

**`MarketRateEngine.sol`** prices credit fully on-chain in USDC from three live inputs:

1. **Pool utilization** — `totalBorrowed / totalSupplied`, run through a kinked rate curve
   (gentle below an 80% kink, steep above it to price scarcity).
2. **Supply vs demand** — willing lenders vs willing borrowers → a signed demand premium
   (more borrowers than lenders ⇒ rates rise; more lenders ⇒ they fall).
3. **Global market conditions** — a benchmark base rate streamed by an off-chain market simulator.

It outputs a **borrow APR** and a single **lender expected yield** (= APR × utilization ×
(1 − reserve)), replacing the fixed senior/junior tranche split with one continuous, market-priced
number. `poke()` / `pushAndPoke()` **persist** the rates on-chain (a real state change +
permissionless automation), and `borrowAprForBand()` feeds `LoanRegistry.setTerms`, so **every loan
is market-priced on-chain**.

- **Multi-step settlement:** World ID verify → ZK income gate → CRE/TEE underwrite → engine prices
  APR → `setTerms` on Arc → borrower `claim()` disburses USDC → repayment via `IncomeRouter`.
- **On-chain automation:** the market simulator (`/api/market`) random-walks global conditions and
  pushes them on-chain; the walk state persists on-chain (serverless-safe).
- **Tests:** 10 dedicated + **101/101** full forge suite.
- **Live evidence:** a demand-heavy push moved borrow APR **6.86% → 39.7%** on Arc.

```
            off-chain simulator (realistic global market)
                        │ pushAndPoke (relayer = marketAdmin)
                        ▼
   utilization ─┐   ┌─────────────────────┐
   supply/demand├──▶│   MarketRateEngine   │── borrowAprForBand ─▶ LoanRegistry.setTerms (Arc)
   base rate ───┘   │  (Arc, fully on-chain)│── currentSupplyYield ─▶ lender "Earn" surface
                    └─────────────────────┘
```

---

## Track 2 — Best Chain-Abstracted USDC App (Arc as a liquidity hub)

Lenders fund the Arc pool **from any chain**, treating multiple chains as one liquidity surface via
**CCTP V2** (burn-and-mint) with Arc as the settlement hub.

- **Live, verified end-to-end:** 2 USDC **Base Sepolia → Arc** —
  burn `0xb292a6aa…` → Circle attestation (~10s, fast) → mint on Arc `0x7c4856b0…`.
- **Seamless UX:** the lender app handles approve → `depositForBurn` → attestation poll →
  `receiveMessage` on Arc → deposit into the pool, across chains, in one flow.
- **Gotcha solved:** CCTP V2 pulls the burn amount via the **TokenMinter** (`localMinter`), so the
  USDC allowance must target the minter, not the TokenMessenger.

```
  Base/ETH Sepolia                 Circle Iris                    Arc (liquidity hub)
  ┌───────────────┐   attestation  ┌─────────┐   message+attest  ┌──────────────────┐
  │ approve minter │──────────────▶│ Iris API │─────────────────▶│ MessageTransmitter│─▶ mint USDC
  │ depositForBurn │   (burn evt)   └─────────┘                   │  → TranchePool    │   → pool
  └───────────────┘                                              └──────────────────┘
```

**Circle tools used:** USDC (Arc native + ERC-20), CCTP V2 (TokenMessengerV2 / MessageTransmitterV2
/ Iris attestation), Arc testnet (chain 5042002, USDC-as-gas). Gateway config is wired for the
unified-balance variant.

---

## Demo flow (single app, both tracks)

1. **Borrower** verifies with World ID, proves income in-browser (ZK), gets a market-priced advance,
   and **clicks Claim** (explicit) → USDC disbursed on Arc → wallet view on Arcscan.
2. **Live market panel** shows the engine's borrow APR / lender yield / utilization; "Advance market"
   pushes new conditions on-chain and the numbers move.
3. **Lender** opens the Earn surface (live expected yield from the engine) and **deposits USDC from
   Base Sepolia via CCTP V2** into the Arc pool.

Demo amounts are shown at a $150/USDC representation so realistic advance sizes fit the testnet pool;
all on-chain amounts are real USDC (6dp).
