# Vouch — a Credit Passport

> Undercollateralized credit for people with real income but no credit history. **Personhood is
> the collateral, the underwriting is private, and the dollars move on Arc.**

A borrower proves they are a **unique human** (World ID); a **private AI underwrites them inside a
TEE** on income data nobody ever sees (Chainlink Confidential AI via a CRE workflow); the loan is
**disbursed and repaid in USDC on Arc** (Circle's L1). Repayment **auto-routes from future income**.
Reputation is bound to the human's identity (**ERC-8004 credit passport**) so a defaulter can't
respawn with a new wallet. Lenders fund a pool **from any chain** (Gateway / CCTP V2) and earn
risk-priced yield via a **senior/junior tranche** model.

Read `CLAUDE.md` first, then `docs/` in order (01 → 07).

## Repo layout
```
contracts/   Foundry — LoanRegistry (the seam), LoanVault, IncomeRouter, TranchePool, PassportRegistry
cre/         Chainlink CRE workflow (TS): underwrite via Confidential AI → setTerms()
circuits/    Noir eligibility circuit (ProveKit)
app/         Frontend: borrower app, lender "Earn", mock creator-payout dashboard
scripts/     deploy, seed-pool, demo runner
docs/        handoff docs (01–07)
```

## Build order (see `docs/06-build-stages.md`)
seam → Arc LoanVault + USDC disburse/repay → CRE + Confidential AI (sim) → World ID gate
(in-contract) → Noir eligibility → cross-chain deposit (Gateway/CCTP) → frontend + payout dashboard
→ senior/junior tranches → polish + demo.

## Current status (per stage)
- ✅ **Stage 0 — foundations.** viem Arc check (`scripts/check-arc.ts`); connects live, asserts chain 5042002.
- ✅ **Stage 1 — the seam.** `LoanRegistry` frozen + tested. **Build against `ILoanRegistry`; don't change the struct without a re-freeze.**
- ✅ **Stage 2 — Arc money layer.** `LoanVault.claim()` (amortized disburse) + `IncomeRouter.onPayout()` split. Tested.
- ✅ **Stage 3 — Chainlink CRE.** `/cre` workflow simulation (trigger → confidential underwrite → `setTerms` encode). Tested; income-never-leaks test. Live CRE run needs the CRE CLI + Confidential AI endpoint.
- ✅ **Stage 4 — World ID gate.** `PassportRegistry.verifyAndMint` (on-chain proof check, one passport/human, lock-out) + optional `LoanVault` good-standing gate. Tested incl. respawn-rejection.
- 🟡 **Stage 5 — Noir circuit.** `/circuits` scaffolded; **uncompiled** (needs `nargo`).
- ✅ **Stage 6 — cross-chain / Liquidity Hub.** `TranchePool` senior/junior accounting + yield waterfall + loss absorption + `deployToVault`; `scripts/bridge-deposit.ts` CCTP V2 burn-and-mint (any chain → Arc). Tested.
- ✅ **Stage 8 — default handling + reputation.** Permissionless `markLate`/`markDefault` (grace period), default → `PassportRegistry` lockout + `TranchePool.absorbLoss` (loss = unrecovered principal); full repayment heals standing + ladders the limit. Tested incl. real-default → respawn-rejection.
- 🟡 **Frontend.** MetaMask + Arc + reads the seam; World ID (IDKit), payout, and lender Earn/deposit wired (need env addresses + `WORLD_APP_ID`).
- ⬜ **Bonus** — Connect-the-World (price/FX feed inside the rate contract); compile the Noir circuit (`nargo`).

**Tests:** contracts 80/80 (`forge test`), CRE 19/19 (`cd cre && npm test`), frontend builds (`cd app && npm run build`).
A full borrow→disburse→repay loop + respawn-rejection is proven in `contracts/test/EndToEnd.t.sol`.

## Setup
```bash
# 1. Foundry (not yet installed on this machine)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# 2. Contracts
cd contracts
forge install foundry-rs/forge-std   # provides forge-std (see remappings.txt)
forge build
forge test                            # Stage 1 milestone: seam read/write + forwarder gating

# 3. Env
cp .env.example .env                  # fill in keys; look up USDC_ADDRESS via Circle MCP

# 4. Circle skills + MCP (before any Circle code) — see CLAUDE.md / docs/03
#   /plugin marketplace add circlefin/skills
#   /plugin install circle-skills@circle
```

## Golden rules (from `CLAUDE.md` — do not violate)
1. **Build the seam first** — done; freeze `ILoanRegistry`.
2. **On-chain = verdict only** — raw income never touches the chain.
3. **Arc testnet only**, chain id `5042002`, RPC `https://rpc.testnet.arc.network`.
4. **Decimals trap** — native gas 18 dec, **USDC ERC-20 6 dec**; never mix.
5. **Never hardcode** token/contract addresses — pull from the Circle MCP / address pages.
6. **CCTP V2**, not V1; Gateway for unified multi-chain balance.
7. **Architect cross-chain, demo single-chain.**
8. **Skills/SDKs over raw calls.**

## Tracks (one causally-chained build, ~$22k core) — `docs/07`
World ID · ProveKit · Chainlink CRE · Confidential AI Attester · Arc Advanced Stablecoin Logic ·
Arc Liquidity Hub. Bonus: Connect the World. Stretch: AgentKit, Agentic Economy (x402).
