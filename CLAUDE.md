# Vouch — Credit Passport · Claude Code Guide

Read this file first, then read `docs/` in order (01 → 07). Before writing any Circle/Arc
code, install Circle's skills + MCP server (see Setup) and read the relevant Circle skill
for the product you're touching.

> Vouch is a working codename. The product is also described as a "Credit Passport."

---

## What we're building (one paragraph)

An undercollateralized credit protocol for people with real income but no credit history
(creators, gig workers, the globally unbanked). A borrower proves they are a **unique human**
(World ID); a **private AI underwrites them inside a TEE** on income data nobody ever sees
(Chainlink Confidential AI, orchestrated by a Chainlink CRE workflow); the loan is **disbursed
and repaid in USDC on Arc** (Circle's L1). Repayment is **auto-routed from the borrower's future
income**. Reputation is bound to the human's identity (an **ERC-8004 credit passport**), so a
defaulter can't escape by spinning up a new wallet. Lenders fund a pool **from any chain**
(Circle Gateway / CCTP) and earn risk-priced yield through a **senior/junior tranche** model.

The whole thesis in one line: **personhood is the collateral, the underwriting is private, and
the dollars move on Arc.**

---

## Golden rules (do not violate)

1. **Build the seam first.** `LoanRegistry.setTerms(...)` is the on-chain interface the Chainlink
   workflow WRITES and the Arc LoanVault READS. Build and freeze it before anything else so both
   halves develop in parallel. See `docs/02-architecture.md`.
2. **On-chain = verdict only.** Raw income / financial data NEVER touches the chain and is NEVER
   persisted by us. Only the attested verdict (`approved, amount, apr, riskBand, attestationRef`)
   goes on-chain. This is the entire privacy thesis — protect it in every component.
3. **Arc is testnet only, chain id `5042002`.** Never target mainnet. RPC
   `https://rpc.testnet.arc.network`. Fund wallets at `https://faucet.circle.com`. Explorer
   `https://testnet.arcscan.app`.
4. **Decimals trap.** On Arc, the native gas token uses **18 decimals**; ERC-20 **USDC uses 6
   decimals**. Mixing them produces wrong amounts. Arc uses USDC as native gas — no ETH anywhere.
5. **Never hardcode token/contract addresses.** Pull them from the Circle MCP server or the Circle
   contract-address pages (links in `docs/03`). They differ per chain.
6. **CCTP V2, not V1.** Use CCTP V2 for cross-chain USDC; use Gateway for a unified multi-chain
   balance. (V1 only where a chain requires it.)
7. **Architect cross-chain, demo single-chain.** Lenders deposit from any chain in the real design,
   but the live demo runs natively on Arc; show the cross-chain deposit with a pre-funded wallet or
   a short recording. Keep the bridge off the live critical path.
8. **Skills/SDKs over raw calls.** Read the Circle skill for a product before coding it; prefer the
   Node/Python SDKs over hand-rolled API calls.

---

## Setup

### 1. Circle skills + MCP server (do this before any Circle code)

Claude Code plugin (LLM-optimized instructions for every Circle product):
```
/plugin marketplace add circlefin/skills
/plugin install circle-skills@circle
```

Circle MCP server (live SDK signatures, contract addresses, chain IDs) — add to MCP config:
```json
{ "mcpServers": { "circle": { "url": "https://api.circle.com/v1/codegen/mcp" } } }
```

### 2. Toolchain
- Node 18+ / TypeScript.
- Foundry (`forge`, `cast`) for Solidity — Arc is EVM-compatible. (Hardhat also fine.)
- `viem` / `wagmi` for chain interaction (Arc testnet is supported by viem by default — no custom
  chain def needed; just verify chain id 5042002).
- Chainlink CRE CLI + CRE TypeScript SDK (see `docs/04`).
- A Circle developer API key (testnet) for Wallets / Gateway / Contracts APIs.

### 3. `.env`
```
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
DEPLOYER_PRIVATE_KEY=
CIRCLE_API_KEY=               # testnet key from developers.circle.com console
WORLD_APP_ID=
WORLD_ACTION_ID=
# Chainlink CRE vars — see docs/04
```
Get testnet USDC (for gas AND for seeding the lending pool) at `https://faucet.circle.com`.

---

## Proposed repo layout
```
/contracts     Foundry — LoanRegistry, LoanVault, TranchePool, PassportRegistry (ERC-8004), IncomeRouter
/cre           Chainlink CRE workflow (TS): underwrite via Confidential AI -> write setTerms()
/circuits      Noir eligibility circuit (ProveKit)
/app           Frontend: borrower app, lender "Earn" surface, mock creator-payout dashboard
/scripts       deploy, seed-pool, demo runner
docs/          these handoff docs
```

---

## Build order
Follow `docs/06-build-stages.md` exactly. Short version:
**seam → Arc LoanVault + USDC disbursement/repayment → CRE + Confidential AI (simulated) →
World ID gate verified in-contract → Noir eligibility circuit → cross-chain deposit (Gateway) →
frontend + mock payout dashboard → senior/junior tranches → polish + demo.**

## Map of the docs
- `docs/01-project-overview.md` — problem, idea, personas, what it enables
- `docs/02-architecture.md` — components, data flow, the seam, on/off-chain split, contracts
- `docs/03-circle-arc-integration.md` — **the money layer**; every Circle product, config, links, gotchas
- `docs/04-chainlink-integration.md` — **the decision layer**; CRE workflow + Confidential AI + price feed
- `docs/05-world-integration.md` — identity + ZK; World ID, ProveKit
- `docs/06-build-stages.md` — phased plan with milestones
- `docs/07-tracks-and-demo.md` — prize-track coverage, demo script, submission checklist
