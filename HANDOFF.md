# Vouch — Project Handoff

> **Shared, stored context for any Claude session in this repo.** Run `/handoff` to load it.
> Keep this file updated as the build moves. Last verified: contracts **86/86**, Noir **2/2**,
> CRE **19/19**, frontend builds clean, and the **real World ID v4 scan → on-chain passport mint
> verified end-to-end** (live phone scan → cloud verify → relayer mint on the local devnet).

---

## 1. What this is (30 seconds)

**Vouch** — an undercollateralized **credit passport** for people with real income but no credit
history. **Personhood is the collateral, the underwriting is private, the dollars move on Arc.**

A borrower proves they're a **unique human** (World ID) → a **private AI underwrites them in a TEE**
on income nobody sees (Chainlink Confidential AI via a CRE workflow) → the loan is **disbursed +
repaid in USDC on Arc** (Circle's L1) → repayment **auto-routes from future income** → reputation is
bound to the human (**ERC-8004 passport**) so a defaulter **can't respawn** with a new wallet.
Lenders fund a **senior/junior tranche** pool from any chain (Gateway / CCTP V2).

---

## 2. The story (the context behind the build)

**Credit Passport — Loans for people banks can't see.** A real human (proven by World ID) gets a
loan with zero collateral, because a private AI judged their income without ever exposing it
(Chainlink), and the money moves instantly in digital dollars (Arc). If they don't repay, they can't
escape it by making a new account — their one-and-only identity carries the record.

### The problem (and why it's real)
If you make real money online — YouTube, Twitch, Upwork, gig driving — but you have no credit history
and no assets to pledge, nobody will lend to you.
- **Banks can't score you:** ~**32M** US adults are "unscoreable" (~7M with no credit file, ~25M too
  thin to score). Globally ~**1.3B** adults are outside the formal financial system entirely.
- **The pain hits the people who DO earn:** 70M+ Americans freelance (~36% of the workforce), yet
  **80%** of full-time freelancers couldn't cover a surprise **$1,000** expense. ~**200M** creators
  generate ~**$100B/yr** and banks admit they can't underwrite them — e.g. streamer Alexandra Botez
  (877k followers, six-figure income) rejected twice for a business card; TierZoo (2.7M subscribers)
  rejected for an apartment.
- **Crypto doesn't fix it:** DeFi lending is almost entirely **overcollateralized** (lock up MORE
  than you borrow), so it only serves people who already have money. Two unsolved blockers:
  - **The respawn problem** — wallets are anonymous; default, make a new wallet, borrow again. No
    incentive to repay.
  - **The privacy problem** — judging a borrower needs their private financials, which nobody wants
    to hand to a stranger or put on a public chain.
- The protocols that DO lend undercollateralized (**Maple, Goldfinch**) only solved it by copying
  banks: whitelisted **institutions** with full KYC. Individual humans are still locked out.

### Why NOW — four primitives matured in ~18 months, and we're the first product that needs all of them
- **Proof of personhood** (World, ~**18M** Orb-verified humans) — one human = one permanent identity.
  Kills the respawn problem.
- **Confidential compute** (Chainlink **Confidential AI**) — an AI reads sensitive data inside a
  sealed hardware box (**TEE**) and outputs only an attested verdict. Kills the privacy problem.
- **Portable on-chain reputation** (**ERC-8004**) — permanent, portable reputation bound to an
  identity, no central gatekeeper.
- **Programmable digital dollars** (**Arc**, Circle's L1) — USDC settles in seconds, gas-free, with
  conditions written in code.

### The idea
A **credit passport** (ERC-8004). Verify as a unique human → mint a portable, person-bound credit
reputation → a private AI underwrites you on income nobody ever sees → you get USDC instantly → you
repay automatically out of future income via a smart-contract interceptor → repayment history updates
the passport, and the passport sets your next limit. **The key invention: your personhood IS the
collateral** — you don't pledge ETH, you pledge the only identity you'll ever have.

### What it enables
Credit for the 1.3B the system can't see (underwritten on real income, not a credit file they don't
have); **privacy by default** (financials never exposed, only the verdict is public); a **reputation
that travels** across every lender that plugs in; a **two-sided "fair-rate" yield market**.

### Persona A — Tunde (the borrower)
24, Lagos, ~**$900/mo** Web3 creator income, wants **$500** for a better camera. No Nigerian bank
will touch him; Aave would demand ~$750 he doesn't have. His flow:
1. **Prove he's one human** — verifies at a World Orb → mints his ERC-8004 passport at level 0.
2. **Connect income privately** — links payout history straight into a sealed enclave (TEE). We never
   see it; the chain never sees it.
3. **ZK eligibility proof** — on his own phone he proves "monthly income > $300" without revealing the
   figure; the proof is checked on-chain as a **gate** before underwriting.
4. **Judged by an AI that can't gossip** — inside the TEE the underwriter reads 12 months of payouts →
   *approved, $500, 10% APR*. The ONLY thing written on-chain is that attested verdict.
5. **Money in seconds** — the Arc loan contract releases 500 USDC.
6. **Repay without thinking** — his income stream pays the loan: when his platform pays him 1,000
   USDC, the contract deducts the loan payment first and forwards the remainder.
- **If he walks away:** his passport is slashed **network-wide** — locked out of credit until he cures
  it, and a new wallet can't escape it because the flag lives on his one verified identity.

### Persona B — Dana (the lender) + the "fair-rate" yield architecture
Holds **50,000** idle USDC, wants real yield without degen risk. Deposits into the **Senior tranche**.
Borrowers pay a fair **10% APY**; a **first-loss tranching** model protects passive lenders while
incentivizing platforms to supply capital:
- **Senior tranche (80%)** — passive lenders like Dana; guaranteed fixed **~6% APY**, insulated from
  initial defaults.
- **Junior tranche (20%)** — first-loss underwriters / platforms; absorb defaults first, take all
  leftover interest.
- **Worked math ($100k pool):** $10k interest generated ($100k × 10%); senior payout $4,800 ($80k ×
  6%); leftover $5,200; junior only put up $20k → **~26% APY**.
- **Protocol formula:** `Y_J = (P·R_B − S·R_S) / J`.

Defaults are contained by design: income-routing collects first, laddered limits cap early losses,
identity deters serial defaulters, and residual default risk is priced into the junior APY.

### Tracks — one causally-chained build (~$22k core)
Removing any piece breaks the product — which is exactly what these judges say they want:
- **World** — Track B World ID ($2,500, the live respawn-rejection demo) + Track D ProveKit ($2,500,
  the Noir eligibility circuit verified client-side).
- **Chainlink** — Best CRE workflow ($6,000) + Confidential AI Attester ($4,000) **from one workflow**;
  + Connect-the-World bonus ($2,000, a Chainlink feed causing an on-chain state change). The verdict
  is what unlocks the money; it never touches the money.
- **Arc** — Advanced Stablecoin Logic ($3,500, conditional disbursement + amortization + income
  routing) + Chain-Abstracted USDC / Liquidity Hub ($3,500, lenders deposit any-chain → one Arc pool
  via Gateway/CCTP V2); Agentic Economy stretch ($3,500, agent pays per-inference via x402).
- **Demo honesty:** architect cross-chain, **run the live demo single-chain on Arc** — show the
  cross-chain deposit with a pre-funded wallet or a clip; keep the bridge off the time-sensitive path.

Full detail lives in `docs/01` (problem/personas) and `docs/07` (track coverage + demo script).

---

## 3. Get oriented fast (read order)

1. This file (`HANDOFF.md`) — story (§2) + current state + how to run.
2. `CLAUDE.md` — the golden rules (do not violate).
3. `docs/01`→`07` — problem, architecture, Circle/Chainlink/World integration, build stages, tracks.
4. The seam: `contracts/src/interfaces/ILoanRegistry.sol` (frozen — everything builds against it).

## 4. Status (per build stage)

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

**Frontend** (`/app`): MetaMask + Arc, reads the seam, **real World ID v4 cloud verify → relayer
mints the passport** (verified end-to-end: live phone scan → on-chain mint). **Borrower-only UI** —
the Earn (lender) + Payout tabs were removed (`App.tsx` renders only `BorrowTab`); the
TranchePool/IncomeRouter contracts still exist for the demo scripts. Builds clean.

**World ID v4 (frontend, `app/server/verify.ts` Vite dev middleware):** the portal app is **World ID
4.0** — app `app_6fb1…`, managed RP `rp_c688…`, RP signer = the deployer `0x9B7c…`. Uses idkit **4.x**
(NOT 2.x — protocol-incompatible). Flow: `POST /api/world/context` signs an `rp_context` nonce with
the RP key (`@worldcoin/idkit-server` `signRequest`) → `IDKitRequestWidget` + `proofOfHuman` produce a
v4 proof → `POST /api/verify` forwards it to `developer.worldcoin.org/api/v4/verify/{rp_id}` → on
success a relayer calls `PassportRegistry.verifyAndMint` (MockWorldID rubber-stamps on-chain; the real
ZK check IS the cloud verify). **Dev gotchas:** (1) idkit's bridge WASM must be served as
`application/wasm` — a middleware in `vite.config.ts` serves `idkit_wasm_bg.wasm` (else no QR,
"Something went wrong"); (2) do NOT `optimizeDeps.exclude` idkit — breaks its `qrcode` CJS interop
(white screen); (3) `allow_legacy_proofs: true` so device-verified phones work, not just Orb.

**Local devnet** (`scripts/devnet.sh`): one command deploys + seeds everything on anvil and writes
`app/.env` — the fastest way to click through the whole UI without testnet funds. See §8.

## 5. Toolchain & installs

| Tool | Status | Path / note |
|---|---|---|
| Node / npm | ✅ | Node 26 |
| Foundry (forge/cast/anvil) | ✅ installed | **not on default PATH** → `export PATH="$HOME/.foundry/bin:$PATH"` |
| Noir (nargo 1.0.0-beta.22) | ✅ installed | `export PATH="$HOME/.nargo/bin:$PATH"` |
| Circle MCP server | config present (`.mcp.json`) | restart Claude Code to connect; then it serves live Arc addresses |
| Circle skills / superpowers plugins | ⚠️ NOT installed | `/plugin` clones over SSH and fail without keys — fix: `git config --global url."https://github.com/".insteadOf "git@github.com:"` then re-run the `/plugin install` slash commands (one per line) |

## 6. Repo map

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

## 7. Architecture & contract wiring

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

## 8. Run it locally (fastest path — no testnet/creds)

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

## 9. Build & test (per workspace)

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

## 10. Environment

Real addresses/creds are **never hardcoded** (Golden Rule #5) — they come from `.env` / the Circle
MCP. Templates: root `.env.example`, `app/.env.example`. Key vars:
- Arc: `ARC_RPC_URL`, `ARC_CHAIN_ID=5042002`, `DEPLOYER_PRIVATE_KEY`, `USDC_ADDRESS` (+ `EURC_ADDRESS`).
- CCTP V2 (domain 26): `CCTP_TOKEN_MESSENGER_V2`, `CCTP_MESSAGE_TRANSMITTER_V2` (+ bridge-deposit envs).
- World ID v4: `VITE_WORLD_APP_ID`, `VITE_WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `RELAYER_PRIVATE_KEY`
  (kept in `app/.env.local`, server-side only — no `VITE_` leak).
- Chainlink CRE: `CONFIDENTIAL_AI_API_URL/KEY`, `LOAN_REGISTRY_ADDRESS`, `CRE_FORWARDER_ADDRESS`.

## 11. Conventions (follow these)

- **Commits: no AI attribution** (no `Co-Authored-By`, no "Generated with"). Author as the user.
- **Arc is testnet only**, chain id **5042002** (Golden Rule #3). Never mainnet.
- **Decimals (Golden Rule #4):** native gas USDC = 18 dp; ERC-20 USDC = **6 dp**. Never mix.
- **CCTP V2, not V1** (#6). **Architect cross-chain, demo single-chain** (#7).
- **Don't modify the frozen seam** (`LoanRegistry`/`ILoanRegistry`) without a coordinated re-freeze.
- Parallel work: independent directories only; verify + integrate before committing.

## 12. Live Arc Testnet deployment (DONE)

Deployed via `script/DeployArc.s.sol` (MockWorldID + full stack on real Arc USDC `0x3600…`), deployer
`0x9B7c50B1110e911DedbdaF505a63f910fA39ee3d` (also the World RP signer + relayer):

| Contract | Arc address (chain 5042002) |
|---|---|
| PassportRegistry | `0x54b123ceC0C4F2caeaF99280EAc2D3E66ae6f50F` |
| LoanRegistry | `0xD5A4bc81bA7b93b4f8a0e6c210a275d1a68FAA38` |
| LoanVault | `0x8b00F14B49962F0c8761B63E598AD878444598b4` |
| IncomeRouter | `0xB2A410EeC3C9C52A0c7Df96Fc93EEDe6cCd8A37a` |
| TranchePool | `0x602dB37B2275450717Aa8f1935dC5bbF24a70E0d` |
| MockWorldID | `0x0E99bEBD374E3c8793F988d55Ff7070E4b232869` |

Explorer: `https://testnet.arcscan.app`. To point the app at Arc, `app/.env.local` overrides the
localhost addresses with these + `VITE_ARC_RPC_URL=https://rpc.testnet.arc.network` and the relayer
key (kept out of git). Run `scripts/devnet.sh` only for the *local* anvil flow.

## 12b. Still blocked on credentials / external setup

- **CRE live run** — CRE CLI + Confidential AI sandbox; then `LoanRegistry.setForwarder(<forwarder>)`.
- **CRE live run** — CRE CLI + Confidential AI sandbox; then `LoanRegistry.setForwarder(<forwarder>)`.
- **World ID live** — World portal app + RP signing key + relayer (see `app/server/verify.ts`).
- **ProveKit** — generate the browser WHIR/Groth16 proof from the compiled circuit; wire the verifier.
- **Plugins** — `/plugin` SSH clone (see §5 fix).

## 13. Sensible next steps

- Connect the **Circle MCP** (restart) → replace placeholder `USDC_ADDRESS` etc. with live Arc values.
- Live **Arc testnet deploy** once funded; paste addresses into `app/.env`.
- **ProveKit** proof generation + on-chain/backend verifier wiring (Stage 5 last mile).
- Harden TODOs: attestation signature verification in `LoanVault`; reentrancy guards in `TranchePool`;
  full indexed-Merkle non-membership in the Noir circuit.
