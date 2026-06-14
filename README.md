# 🪪 Veritas

*Credit for the people the system can't see — backed by who you are, not what you own.*

Veritas is an undercollateralized lending protocol that gives real people a fair cash advance against income they've **already earned** — with zero collateral and no credit history required. A borrower proves they're a unique human, a private AI underwrites their real income inside a sealed enclave (so the numbers are never exposed to anyone), and USDC is disbursed in seconds on Arc. Repayment is routed automatically out of future income, and every loan builds a portable, identity-bound **credit passport**.

Built at ETHGlobal 2026, Veritas combines proof-of-personhood, confidential AI underwriting, zero-knowledge proofs, and programmable stablecoin settlement into one product where **your verified identity is the collateral.**

## ✨ Inspiration

We wanted to fix the most backwards thing in finance: the people who most need a fair loan are the ones locked out of getting one.

Roughly **1.3 billion adults** are outside the formal financial system, and tens of millions of creators and gig workers earn real money but have no credit file a bank can score. Crypto doesn't fix this either — DeFi lending is almost entirely **overcollateralized**, so it only serves people who already have money to lock up.

The reason nobody had cracked undercollateralized lending for individuals came down to two unsolved problems:

- **The respawn problem** — wallets are anonymous, so a borrower can default and just make a new wallet. No reason to repay.
- **The privacy problem** — to judge a borrower you need their private financials, and nobody wants to hand those to a stranger or post them on a public chain.

Three things matured recently that finally make this solvable together: proof-of-personhood (one human, one identity, forever), confidential compute (judge private data inside a sealed box, reveal only the verdict), and programmable digital dollars (instant, conditional USDC settlement). Veritas is the first product that needs all three.

## 💸 What It Does

Veritas turns "are you good for it?" into something a smart contract can answer — privately, fairly, and without collateral.

**For borrowers:**
- Prove you're a unique human with World ID (this mints your credit passport).
- Prove your income clears the bar with an in-browser zero-knowledge proof — without revealing the actual number.
- A private AI reads your real income inside a sealed enclave and returns an attested verdict (approved, amount, APR). Your numbers are never exposed.
- Receive USDC on Arc in seconds, with gas paid in USDC (no separate token to buy).
- Repay automatically — a slice of each future payout clears the loan. Pay well, and your passport unlocks a higher limit. Walk away, and the flag lives on your one-and-only identity, so you can't escape it with a fresh wallet.

**For lenders:**
- Deposit USDC from any chain — it settles into one pool on Arc, no manual bridging.
- Pick your risk: a **senior** tranche (fixed, first-loss-protected yield) or a **junior** tranche (absorbs defaults first, earns the residual).
- Earn real yield backed by thousands of small, income-routed advances.

**The core invention:** you don't pledge crypto as collateral — you pledge the only identity you'll ever have.

## 🧱 How We Built It

Veritas is built as three connected layers, joined by a single on-chain "seam" so each layer could be built in parallel.

**1. Identity layer (World)**
Proves *who* the borrower is. World ID confirms a unique human and mints an **ERC-8004 credit passport** that carries reputation. A **Noir / ProveKit** circuit lets the borrower prove "income ≥ threshold" entirely on their own device — only the proof leaves, never the figure.

**2. Decision layer (Chainlink)**
Makes the *private* call. A **Chainlink CRE** workflow is the orchestration spine: it ingests the borrower's income, calls a **Confidential AI** model running inside a TEE (Trusted Execution Environment), reaches consensus across the DON, and writes only the attested verdict on-chain through the Forwarder. Raw income never touches a public node, and never lands on-chain.

**3. Money layer (Arc / Circle)**
Moves the *dollars*. A suite of Solidity contracts on Arc settle everything in USDC:
- `LoanRegistry` — the seam; the only place loan terms are written (by Chainlink) and read (by the vault).
- `LoanVault` — conditional disbursement (releases USDC only on a valid attestation + good standing) plus a fixed-term, equal-installment amortization schedule.
- `IncomeRouter` — intercepts a payout, splits the repayment slice to the vault, forwards the rest to the borrower, all atomically.
- `TranchePool` — senior/junior lender accounting with a share-based yield-and-loss waterfall.
- `RateModel` — reads a Chainlink price/FX feed to set an on-chain APR.
- `PassportRegistry` — the ERC-8004 reputation that gates loans and updates on repayment.

Cross-chain lender deposits flow into Arc through **Circle Gateway / CCTP**, with Arc as the settlement hub.

The most important design decision: **only the verdict ever crosses on-chain — never the raw income** — and **Chainlink never touches USDC**; it delivers the decision, and Arc moves the money.

## 🛠️ Tech Stack

- **Smart contracts:** Solidity, Foundry, deployed on **Arc** (Circle's USDC-native L1)
- **Stablecoin & settlement:** USDC / EURC, Circle
- **Cross-chain:** Circle **Gateway** / **CCTP V2**
- **Identity:** **World ID** (IDKit + cloud verification, nullifier-based sybil resistance)
- **Zero-knowledge:** **Noir** + **ProveKit** (R1CS, WHIR/Groth16), on-chain `HonkVerifier`
- **Oracle / compute:** **Chainlink CRE** (TypeScript SDK), **Confidential AI** attester (TEE), Chainlink **Data Feeds**
- **Reputation:** **ERC-8004** credit passport
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, wagmi / viem
- **Tooling:** CRE CLI, `nargo`, Node.js

## 🔌 How We Use Each Sponsor

**World**
- **World ID** — personhood verification (IDKit → backend cloud verify). The nullifier enforces one-passport-per-human, which is what makes "no respawning after default" actually work.
- **ProveKit / Noir** — a client-side eligibility circuit compiled to R1CS, proven in the browser, and verified on-chain via `HonkVerifier`. It's the private gate before underwriting runs.

**Chainlink**
- **CRE** — the underwriting workflow is the orchestration layer of the whole product: trigger → confidential inference → consensus → on-chain write. No workflow, no loan.
- **Confidential AI Attester** — the same workflow submits real financial data to the TEE and our `LoanVault` consumes the attestation before releasing funds.
- **Data Feeds** — `RateModel` reads a feed to persist an effective APR on-chain (a real state change, useful for localized EURC loans).

**Arc / Circle**
- **Advanced stablecoin logic** — `LoanVault`, `IncomeRouter`, `TranchePool`, and `RateModel` implement conditional escrow, programmable amortization, multi-step settlement, and a tranche yield waterfall, all in USDC.
- **Chain-abstracted USDC** — lenders fund the pool from any chain via Gateway/CCTP, with Arc as the liquidity hub.

## 📚 What We Learned (New Skills!)

*(swap in your names)*

**[Name] — Smart contracts & stablecoin logic**
I learned how to design a *system* of contracts instead of one monolith — using a shared `LoanRegistry` seam so the money layer and decision layer could be built independently. The hardest parts were getting the tranche yield-and-loss waterfall to distribute pro-rata with share math, handling USDC's 6 decimals everywhere, and making disbursement strictly conditional on an off-chain attestation.

**[Name] — Chainlink CRE & Confidential AI**
I learned how to build a CRE workflow as a real orchestration layer: triggering on an application, calling a Confidential AI model inside a TEE so sensitive income never hits a public node, reaching DON consensus, and writing only the attested verdict back on-chain through the Forwarder. Reasoning about what should stay private versus what's safe to put on-chain completely reshaped the design.

**[Name] — World ID & zero-knowledge**
I learned how proof-of-personhood and zero-knowledge proofs actually fit together. I wired up World ID verification and the nullifier as our anti-sybil backbone, and built a Noir circuit with ProveKit that proves "income ≥ threshold" in the browser without revealing the number, then verified it on-chain. Understanding *why* you'd use a ZK proof and a confidential AI for two different jobs was the big unlock.

**[Name] — Frontend & integration**
I learned how to make a Web3 product feel like a normal money app — abstracting away wallets and chains so a borrower just signs in and a lender just clicks "deposit," even when funds are moving cross-chain underneath. Stitching the identity, decision, and money layers into one coherent flow taught me a lot about where complexity should be hidden.

## 🚀 Setup

Veritas is a monorepo with separate packages for the contracts, frontend, ZK circuits, and the Chainlink workflow.

**Prerequisites**
- Node.js 18+ and npm
- [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`)
- [Noir / `nargo`](https://noir-lang.org/) + ProveKit (for the ZK circuit)
- Chainlink CRE CLI (for the underwriting workflow)
- An Arc testnet wallet funded at [faucet.circle.com](https://faucet.circle.com)

**1. Clone the repository**
```bash
git clone <your-repo-url>
cd EthGlobal26
```

**2. Set up environment variables**
Create a `.env` from the example values:
```bash
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
DEPLOYER_PRIVATE_KEY=
CIRCLE_API_KEY=
WORLD_APP_ID=
WORLD_ACTION_ID=mint-credit-passport
# Chainlink CRE + Confidential AI keys — see underwriter-layer/
```

**3. Smart contracts (Arc)**
```bash
cd contracts
forge install
forge build
forge test
# deploy with your Arc deploy script
```

**4. ZK eligibility circuit**
```bash
cd circuits
npm ci
# compile + prove + verify with nargo / ProveKit (see circuits/README.md)
```

**5. Chainlink CRE workflow**
```bash
cd cre        # and underwriter-layer/cre-workflow
npm ci
# simulate the underwriting workflow with the CRE CLI
```

**6. Frontend (borrower app)**
```bash
cd app
npm ci
npm run dev
```
Open the local URL shown in your terminal (usually `http://localhost:5173`).

**7. Lender app**
```bash
cd metamask-lender
npm ci
npm run dev
```

---

Built with USDC on Arc, World ID, Chainlink CRE + Confidential AI, and Noir/ProveKit. 🪪
