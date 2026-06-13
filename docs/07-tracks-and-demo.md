# 07 · Tracks, Coverage & Demo

## Coverage (one causally-chained build, six core tracks)
| Company | Track | Prize | Status | What satisfies it |
|---|---|---|---|---|
| World | Track B — World ID | $2,500 | Core | proof-of-human gate; proof validated in `PassportRegistry` on-chain; respawn-rejection |
| World | Track D — ProveKit | $2,500 | Core | Noir eligibility circuit, client-side proof, on-chain/backend verify |
| Chainlink | Best CRE workflow | $6,000 | Core | the underwriting workflow (trigger → Confidential HTTP → consensus → write setTerms) |
| Chainlink | Confidential AI Attester | $4,000 | Core | same workflow submits real confidential inference; contract consumes attestation |
| Arc | Advanced Stablecoin Logic | $3,500 | Core | LoanVault conditional disbursement + amortization + IncomeRouter split |
| Arc | Chain Abstracted USDC (Liquidity Hub) | $3,500 | Core | lender deposits any-chain → Arc pool via Gateway/CCTP |
| Chainlink | Connect the World | $2,000 | Bonus | price/FX feed read inside rate contract (on-chain state change) |
| World | Track A — AgentKit | $7,500 | Stretch | human-backed credit agent + free-assessment trial mechanic |
| Arc | Agentic Economy | $3,500 | Stretch | credit agent pays per inference via x402 nanopayments |

**Core path ≈ $22,000** from one build where removing any piece breaks the product — which is what
every one of these judges says they want. Bonus + stretch on top if time allows.

## Why each is a real fit (not a checkbox)
- The verdict (Chainlink) is what unlocks the money (Arc); the human-proof (World) is what makes the
  borrower allowed to act and unable to respawn. Causally chained, not bolted together.
- Two Chainlink tracks come from one workflow; two Arc tracks are two genuinely different builds
  (loan logic vs cross-chain deposit) — so nothing is double-counted.

## Submission requirements (per sponsor — all three demand these)
For **each** of Arc, Chainlink, World, prepare:
- Working frontend + backend, public GitHub repo with a clear README.
- **Architecture diagram** (reuse the Excalidraw flow).
- A short demo video + presentation; **state explicitly which bounty each submission targets**
  (especially Arc — name Advanced Stablecoin Logic and, separately, Liquidity Hub).
Chainlink: show a successful CRE **simulation** (they'll deploy it live for you). Confidential AI:
show ≥1 sandbox inference. World: proof validated in-contract.

## Demo script (~3 minutes; three money-shots)
1. **Borrow, with invisible income.** In the app, Tunde verifies (World ID), generates the Noir
   proof in-browser (figure never leaves the device), the CRE workflow underwrites, and the screen
   shows "approved $500." Point at the Arc explorer: only the verdict landed — no income figures.
   *(covers World ID, ProveKit, CRE, Confidential AI, and the attestation→disbursement seam)*
2. **The defaulter who can't respawn.** Open a fresh wallet, try to borrow as the same human — the
   contract rejects it. *(covers the personhood-as-collateral thesis)*
3. **Money that moves and repays itself.** USDC disburses on Arc in seconds; then trigger the mock
   creator payout and watch the cash-out split live (slice → loan, rest → borrower). Briefly show a
   lender depositing from another chain landing in the Arc pool (pre-funded/clip).
   *(covers Arc Advanced Stablecoin Logic + Liquidity Hub)*

## Pitch framing (for judges; ETHGlobal weights problem + feasibility)
- Problem + personas first (real exclusion, real faces) — see docs/01.
- Why-now: overcollateralization gap + the three converging primitives.
- Business: two-sided market, senior/junior "fair-rate" yield, origination fee + spread; comps
  prove willingness to pay (Spotter, Karat, Pipe, earned-wage access).
- Volunteer the honest risks (identity is deterrent, income-routing is recovery; sybil resistance is
  strong-but-not-absolute; cross-chain is async/off the critical path).
