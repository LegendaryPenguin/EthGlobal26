# Vouch — Project Handoff

> **Shared, stored context for any Claude session in this repo.** Run `/handoff` to load it.
> Keep this file updated as the build moves. Last verified: contracts **86/86**, Noir **2/2**,
> CRE **19/19**, frontend builds clean.

---

## 1. What this is (30 seconds)

**Vouch** — an undercollateralized **credit passport** for people with real income but no credit
history. **Personhood is the collateral, the underwriting is private, the dollars move on Arc.**

A borrower proves they're a **unique human** (World ID) → a **private AI underwrites them in a TEE**
on income nobody sees (Chainlink Confidential AI via a CRE workflow) → the loan is **disbursed +
repaid in USDC on Arc** (Circle's L1) → repayment **auto-routes from future income** → reputation is
bound to the human (**ERC-8004 passport**) so a defaulter **can't respawn** with a new wallet.
Lenders fund a **senior/junior tranche** pool from any chain (Gateway / CCTP V2).

Hackathon target: ~$22k across 6 core tracks (World ID, ProveKit, Chainlink CRE, Confidential AI,
Arc Advanced Stablecoin Logic, Arc Liquidity Hub) + Connect-the-World bonus. See `docs/07`.

## 2. Get oriented fast (read order)

1. This file (`HANDOFF.md`) — current state + how to run.
2. `CLAUDE.md` — the golden rules (do not violate).
3. `docs/01`→`07` — problem, architecture, Circle/Chainlink/World integration, build stages, tracks.
4. The seam: `contracts/src/interfaces/ILoanRegistry.sol` (frozen — everything builds against it).

## 3. Status (per build stage)

| Stage | What | Status |
|---|---|---|
| 0 | Foundations — Arc config, `scripts/check-arc.ts` (live chain-id check) | ✅ |
| 1 | **The seam** — `LoanRegistry` (frozen `Terms`, `setTerms`/`getTerms`) | ✅ |
| 2 | Arc money layer — `LoanVault.claim()` amortized disburse + `IncomeRouter` split | ✅ |
| 3 | Chainlink CRE — `/cre` workflow **simulation** (trigger→underwrite→encode `setTerms`) | ✅ sim |
| 4 | World ID gate — `PassportRegistry` (real **v4 cloud verify**, one passport/human, lockout) | ✅ |
| 5 | ProveKit / Noir — `/circuits` compiles on nargo 1.0; `nargo test` 2/2; `nargo compile` → ACIR | ✅ |
| 6 | Liquidity Hub — `TranchePool` senior/junior + yield waterfall; `scripts/bridge-deposit.ts` (CCTP V2) | ✅ |
| 8 | Default handling — permissionless `markLate`/`markDefault` (grace) → lockout + `absorbLoss`; full-repay heals + ladders limit | ✅ |
| Bonus | Connect the World — `RateModel` reads a Chainlink feed, persists effective APR on-chain | ✅ |

**Frontend** (`/app`): MetaMask + Arc, reads the seam, World ID v4 (cloud verify + relayer mint),
Borrow/Claim, lender Earn (approve+deposit), mock Payout. Builds clean.

**Local devnet** (`scripts/devnet.sh`): one command deploys + seeds everything on anvil and writes
`app/.env` — the fastest way to click through the whole UI without testnet funds. See §7.

## 4. Toolchain & installs

| Tool | Status | Path / note |
|---|---|---|
| Node / npm | ✅ | Node 26 |
| Foundry (forge/cast/anvil) | ✅ installed | **not on default PATH** → `export PATH="$HOME/.foundry/bin:$PATH"` |
| Noir (nargo 1.0.0-beta.22) | ✅ installed | `export PATH="$HOME/.nargo/bin:$PATH"` |
| Circle MCP server | config present (`.mcp.json`) | restart Claude Code to connect; then it serves live Arc addresses |
| Circle skills plugin / superpowers plugin | ⚠️ NOT installed | `/plugin` clones over SSH and fail without keys — fix: `git config --global url."https://github.com/".insteadOf "git@github.com:"` then re-run the `/plugin install` slash commands (one per line) |

## 5. Repo map

```
contracts/    Foundry. src/: LoanRegistry (seam), LoanVault, IncomeRouter, TranchePool,
              PassportRegistry, RateModel. interfaces/, libraries/ByteHasher. test/ (86 tests).
              script/: Deploy (testnet), SetupLocal + DemoLocal (anvil).
cre/          Chainlink CRE workflow SIMULATION (TS, node --test). underwrite→buildReport→setTerms.
circuits/     Noir eligibility circuit (income≥threshold + default-list non-membership). verify/ stub.
app/          Vite + React + wagmi + MetaMask. World ID v4 via server/verify.ts (dev middleware).
scripts/      arc.ts, check-arc.ts; bridge-deposit.ts (CCTP V2) + CCTP.md; devnet.sh / devnet-stop.sh / demo-local.sh.
docs/         01–07 handoff docs (source of truth for the design).
```

## 6. Architecture & contract wiring

**The seam (frozen — Golden Rule #1):** `LoanRegistry.setTerms(Terms)` is written by the Chainlink
CRE Forwarder and read by `LoanVault`. The `Terms` struct
(`borrower, passportId, principal[6dp], aprBps, riskBand, attestationRef, expiry, approved`) must NOT
change without a coordinated re-freeze across `/cre` and `/contracts`.

**On-chain = verdict only (Golden Rule #2):** raw income never touches the chain — only the attested
verdict. Protected in every component (the CRE sim has a test asserting the payload never leaks).

**Contracts & relationships:**
- `LoanRegistry` — the seam. `onlyForwarder` writes; anyone reads.
- `PassportRegistry` (ERC-8004) — World ID `verifyAndMint`, one passport per nullifier, standing
  (Good/Late/Defaulted/LockedOut), limit ladder. The `reputationOracle` (= `LoanVault`) drives
  transitions; `verifyAndMint` reverts for a LockedOut human (anti-respawn).
- `LoanVault` — reads the seam, gates on passport good-standing (optional, settable), disburses USDC
  (30-day / 4-installment simple-interest amortization), `repay()` (router-only), permissionless
  `markLate`/`markDefault` (default → loss to pool + lockout in passport).
- `IncomeRouter` — `onPayout(borrower, amount)` pulls USDC, splits slice→vault / remainder→borrower.
- `TranchePool` — senior/junior shares accounting, yield waterfall (senior fixed ~6% first, junior
  residual ~26%), `absorbLoss` (junior first; callable by owner or `lossReporter` = vault),
  `deployToVault` funds the vault.
- `RateModel` — Connect-the-World bonus: reads a Chainlink `AggregatorV3` feed, persists an effective
  APR on-chain (the required state change).

**Deploy wiring** (`Deploy.s.sol` / `SetupLocal.s.sol`): registry → passport → vault → router → pool,
then `vault.setRouter`, `vault.setPassportRegistry`, `passport.setReputationOracle(vault)`,
`pool.setLossReporter(vault)`, `vault.setTranchePool(pool)`.

## 7. Run it locally (fastest path — no testnet/creds)

```bash
export PATH="$HOME/.foundry/bin:$PATH"
scripts/devnet.sh            # boots persistent anvil (chain 5042002), deploys+seeds, writes app/.env
cd app && npm install && npm run dev
# MetaMask: add network RPC http://127.0.0.1:8545, chain id 5042002.
# Import borrower key 0x59c6...690d (anvil #1) — has USDC + an APPROVED $500 loan → click "Claim".
scripts/devnet-stop.sh       # stop anvil
```
World ID UI stays disabled locally (IDKit needs the real World sequencer) — the passport is
pre-seeded so you skip to Claim. `scripts/demo-local.sh` / `DemoLocal.s.sol` run the full lifecycle
headless.

## 8. Build & test (per workspace)

```bash
# Contracts (86 tests)
export PATH="$HOME/.foundry/bin:$PATH"; cd contracts && forge build && forge test
# Noir circuit (2 tests, + ACIR)
export PATH="$HOME/.nargo/bin:$PATH"; cd circuits && nargo test && nargo compile
# CRE simulation (19 tests)
cd cre && npm install && npm test && npm run sim
# Frontend
cd app && npm install && npm run build      # or: npm run dev
# CCTP bridge (safe to run dry — prints needed env and exits 0)
cd scripts && npm install && npm run bridge-deposit
```

## 9. Environment

Real addresses/creds are **never hardcoded** (Golden Rule #5) — they come from `.env` / the Circle
MCP. Templates: root `.env.example`, `app/.env.example`. Key vars:
- Arc: `ARC_RPC_URL`, `ARC_CHAIN_ID=5042002`, `DEPLOYER_PRIVATE_KEY`, `USDC_ADDRESS` (+ `EURC_ADDRESS`).
- CCTP V2 (domain 26): `CCTP_TOKEN_MESSENGER_V2`, `CCTP_MESSAGE_TRANSMITTER_V2` (+ bridge-deposit envs).
- World ID v4: `VITE_WORLD_APP_ID`, `VITE_WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `RELAYER_PRIVATE_KEY`
  (kept in `app/.env.local`, server-side only — no `VITE_` leak).
- Chainlink CRE: `CONFIDENTIAL_AI_API_URL/KEY`, `LOAN_REGISTRY_ADDRESS`, `CRE_FORWARDER_ADDRESS`.

## 10. Conventions (follow these)

- **Commits: no AI attribution** (no `Co-Authored-By`, no "Generated with"). Author as the user.
- **Arc is testnet only**, chain id **5042002** (Golden Rule #3). Never mainnet.
- **Decimals (Golden Rule #4):** native gas USDC = 18 dp; ERC-20 USDC = **6 dp**. Never mix.
- **CCTP V2, not V1** (#6). **Architect cross-chain, demo single-chain** (#7).
- **Don't modify the frozen seam** (`LoanRegistry`/`ILoanRegistry`) without a coordinated re-freeze.
- Parallel work: independent directories only; verify + integrate before committing.

## 11. Blocked on credentials / external setup

- **Live Arc deploy** — needs a funded key (`https://faucet.circle.com`) + live USDC/contract
  addresses (Circle MCP). Then `forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast`.
- **CRE live run** — CRE CLI + Confidential AI sandbox; then `LoanRegistry.setForwarder(<forwarder>)`.
- **World ID live** — World portal app + RP signing key + relayer (see `app/server/verify.ts`).
- **ProveKit** — generate the browser WHIR/Groth16 proof from the compiled circuit; wire the verifier.
- **Plugins** — `/plugin` SSH clone (see §4 fix).

## 12. Sensible next steps

- Connect the **Circle MCP** (restart) → replace placeholder `USDC_ADDRESS` etc. with live Arc values.
- Live **Arc testnet deploy** once funded; paste addresses into `app/.env`.
- **ProveKit** proof generation + on-chain/Backend verifier wiring (Stage 5 last mile).
- Harden TODOs: attestation signature verification in `LoanVault`; reentrancy guards in `TranchePool`;
  full indexed-Merkle non-membership in the Noir circuit.
