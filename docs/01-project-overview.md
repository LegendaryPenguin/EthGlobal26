# 01 · Project Overview

## The problem
People who earn real money online — creators, freelancers, gig workers — but have no credit
history and no assets to pledge cannot get a loan. Banks can't score them (~32M US adults are
"unscoreable"; ~1.3B adults globally are unbanked). DeFi is worse: it's almost entirely
**overcollateralized**, so it only serves people who already have money. Two unsolved blockers:

- **The respawn problem** — wallets are anonymous, so a defaulter just makes a new wallet. No
  incentive to repay.
- **The privacy problem** — judging a borrower needs their private financials, which nobody wants
  to hand over or put on a public chain.

Existing on-chain credit (Maple, Goldfinch) only works by lending to whitelisted **institutions**
with full KYC. Individual humans are still locked out.

## Why now
Three primitives matured recently and our product is the first to need all of them together:
- **Proof of personhood** (World) — one human = one permanent identity. Kills the respawn problem.
- **Confidential compute** (Chainlink Confidential AI) — judge private data inside a TEE, output
  only an attested verdict. Kills the privacy problem.
- **Programmable digital dollars** (Arc / Circle) — instant, gas-free, conditional USDC settlement,
  globally.
- **Portable on-chain reputation** (ERC-8004) — bind reputation to an identity without a central
  gatekeeper.

## The idea
A **credit passport**. Verify as a unique human → mint a portable, person-bound credit reputation
(ERC-8004). A private AI underwrites you on income data nobody sees. You receive USDC instantly.
Repayment auto-routes from your future income. Your repayment history updates the passport, and the
passport sets your next limit. **Your personhood is the collateral.**

## What it enables
- Credit for the people the system can't see, underwritten on real income.
- Privacy by default — financials never exposed; only the verdict is public.
- A reputation that travels across every lender that plugs in.
- Default with real consequences on-chain (the same human can't respawn).
- A new risk-priced yield market for lenders.

## Persona A — the borrower (Tunde)
24, Lagos, ~$900/mo creator income, wants a $500 advance, no bank will lend, no collateral.
Flow: verify human (World ID, mints passport) → connect income privately (into a TEE) → ZK
eligibility proof (income ≥ threshold) → AI underwrites in TEE, writes only the verdict on-chain →
USDC disbursed on Arc in seconds → repayment auto-routed from future payouts → limits ladder up as
he repays. Default is graded/recoverable (late = minor ding; cure = re-enter low; walk away =
network-wide lockout that a new wallet can't escape).

## Persona B — the lender (Dana)
Holds idle USDC, wants real yield without degen risk. Deposits into the pool from whatever chain her
funds live on (Gateway/CCTP → Arc), picks a tranche, earns. Senior/junior tranche model:
- **Senior (~80% of pool):** fixed ~6% APY, first-loss-protected. For passive lenders.
- **Junior (~20%):** absorbs defaults first, takes all leftover interest (~26% APY in the worked
  example). For risk-takers / platforms.

Defaults are contained by design: income-routing collects first, laddered limits cap early losses,
identity deters serial defaulters, residual default is priced into the APY.
