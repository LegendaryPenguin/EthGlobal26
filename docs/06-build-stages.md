# 06 · Build Stages

Sequenced to protect the demo: build the seam first so the two halves develop in parallel, get one
thin end-to-end loop working, then deepen. **De-scope by simplifying within a stage, never by
skipping the spine.** "Core" = must-win; "Stretch" = only if core demos cleanly.

## Stage 0 — Foundations (everyone)
- Repo scaffold per CLAUDE.md layout. Install Circle skills + MCP. Read `use-arc`, `use-usdc`.
- Add Arc testnet to Foundry/viem (chain id 5042002, RPC). Fund deployer at faucet.circle.com.
- Deploy a trivial contract on Arc; confirm USDC-as-gas works and read a USDC balance (6 decimals).
- **Milestone:** a tx on Arc explorer, gas paid in USDC, decimals handling verified.

## Stage 1 — The seam (do before splitting work)
- Implement and deploy `LoanRegistry` (the `Terms` struct + `setTerms` onlyForwarder + `getTerms`).
- Stub a script that calls `setTerms` with a fake approved verdict, and `LoanVault` reads it.
- **Milestone:** terms can be written and read on Arc. Freeze the interface. Now split:
  team member A → Arc/money; team member B → Chainlink/decision; (C → World/ZK + frontend).

## Stage 2 — Arc money layer (Core: Advanced Stablecoin Logic)
- `LoanVault.claim()` — reads `getTerms`, checks approved + valid `attestationRef`, disburses USDC.
- `IncomeRouter.onPayout()` — split a mock payout: repayment slice → vault, remainder → borrower.
- Amortization schedule in the vault.
- **Milestone:** an approved loan disburses USDC; a mock payout repays it via the router. (This
  alone qualifies the Advanced Stablecoin Logic track.)

## Stage 3 — Chainlink decision layer (Core: CRE + Confidential AI)
- CRE workflow (TS): HTTP trigger → Confidential HTTP to the Confidential AI sandbox → consensus →
  write `setTerms` via Forwarder. Set the Forwarder as authorized writer on `LoanRegistry`.
- Submit ≥1 real confidential inference over sample payout data.
- **Milestone:** a simulated CRE run takes income in and lands an approved verdict on-chain, which
  Stage-2's vault then disburses against. (Qualifies CRE + Confidential AI.)

## Stage 4 — World ID gate (Core: World ID)
- IDKit on the frontend; `PassportRegistry.verifyAndMint` validates the proof on-chain via the World
  ID verifier; nullifier → one passport per human.
- **Milestone:** verify a human → passport minted; a second wallet from the same human maps to the
  same passport (respawn-rejection demo works).

## Stage 5 — Noir eligibility proof (Core: ProveKit)
- Noir circuit (income ≥ threshold, not on default list) → R1CS → client-side WHIR/Groth16 proof →
  verify in backend or on-chain verifier → gate underwriting.
- **Milestone:** in-browser proof generated; gate opens; figure never leaves device.

## Stage 6 — Cross-chain deposits (Core: Liquidity Hub)
- Lender deposit from another chain → Arc pool via **Gateway** (unified balance) or **CCTP V2**
  (Ethereum→Arc quickstart). Withdraw routes back to home chain.
- **Milestone:** a deposit initiated on another testnet shows up in the Arc pool. (Architect real;
  demo via pre-funded balance / clip.)

## Stage 7 — Frontend + mock payout dashboard
- Borrower app (apply → World ID → proof → approved → claim → repayment status).
- Lender "Earn" surface (pick Senior/Junior, deposit, position, withdraw).
- Mock creator-payout dashboard whose "cash out" button really calls `IncomeRouter.onPayout` and
  shows the split. (See the storyboard for the two screens that win the demo.)
- **Milestone:** both flows clickable; the two money-shots fire on real contract calls.

## Stage 8 — Yield + polish
- `TranchePool` senior/junior accounting + yield waterfall (docs/01 math).
- Default-state transitions in `PassportRegistry` (late / cure / walk-away).
- **Milestone:** lender sees a real yield position; default updates the passport.

## Stretch (only if Stage 0–8 are solid)
- Credit agent (AgentKit + Delegated World ID) → also enables Arc Agentic Economy via x402.
- Connect-the-World bonus: price/FX feed read inside the rate contract (likely already added in
  Stage 2/3 rate logic — confirm it causes an on-chain state change).
- StableFX / EURC localized loans. Walrus storage for encrypted income docs.

## Parallelization map
- A (Arc/Solidity): Stages 1→2→8 + IncomeRouter/TranchePool.
- B (Chainlink): Stage 3 + the rate feed for Connect-the-World.
- C (World/ZK/frontend): Stages 4→5→7.
All three converge on `LoanRegistry` (the seam) and the demo runner in `/scripts`.
