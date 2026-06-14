# Vouch — Integration branch (full-flow assembly)

This branch (`integration`) combines all four workstreams into one product flow. It was built in an
isolated git worktree so it never disturbs active work on `stage-2-loanvault`.

## What got combined (Phase 1 — grafted, done)
| Piece | From branch | Lands as | Role |
|---|---|---|---|
| Borrower app + contracts + seam + rate | `stage-2-loanvault` (trunk) | `app/`, `contracts/`, `circuits/src` | identity-first borrower flow + money/identity/seam |
| Real CRE decision layer | `stage-1-underwriter` | `underwriter-layer/` | World ID + wallet-score + Confidential AI → verdict |
| Real ZK proving | `shiva-work` | `circuits/prove.js` + artifacts | client-side Noir proof gen + verify |
| Lender UI (MetaMask) | `frontend-metamask-lender` | `metamask-lender/` | lender deposit + real CCTP V2 + tx-hashes/Arcscan |

Grafted by **directory** (not branch-merge) because the lender branch had diverged on the shared
`app/`+`contracts/`; trunk's versions are canonical, the other trees are self-contained.

## The two personas, one flow
- **Borrower** (`app/`, identity-first — no MetaMask): Sign in with World ID *session* → server
  provisions a custodial managed wallet, mints the ERC-8004 passport → **underwriter** sets terms →
  managed wallet claims USDC on Arc.
- **Lender** (`metamask-lender/`, MetaMask): connect → pick Senior/Junior tranche → deposit
  (real CCTP V2 from Base/Eth Sepolia → Arc) → see position + tx hashes + Arcscan links.

## The seam adapter (Phase 2 — done)
`underwriter-layer/cre-workflow/modules/settle-loanregistry.ts` maps the underwriter's
`CreditDecision {approved, principal, tranche, riskBand}` → the frozen `Terms` struct and writes
`LoanRegistry.setTerms(Terms)` via the forwarder key (the live path the borrower server already
uses). `attestationRef` = the Confidential-AI transcript digest, satisfying the LoanVault gate.
- Band → APR: A=8% B=12% C=18% D=26% E=36%; principal parsed to 6-dp USDC.
- Two settlement paths documented: production CRE `writeReport` (needs CRE CLI/DON) vs this
  viem direct-write demo path (runnable now).

## Wiring the underwriter into the borrower flow (Phase 3 — DONE)
`app/server/verify.ts` `/api/world/signin` no longer hardcodes terms. It now calls
`app/server/underwrite.ts` → maps the decision → writes `setTerms(Terms)` via the relayer/forwarder.
`underwrite()` calls the Confidential AI endpoint when `CONFIDENTIAL_AI_API_URL` is set, else a
deterministic local policy (band→APR, per-human) so the full flow runs without sandbox creds. The
`attestationRef` is the verdict digest, satisfying the LoanVault gate.
> **DONE (was "remaining"):** in-browser Noir proof generation is now the literal ZK gate before
> approval. `app/src/hooks/useProveEligibility.ts` generates an UltraHonk proof in the browser (bb.js
> lazy-chunked into the Vite bundle — it builds), and `app/server/verify.ts` `/signin` verifies it
> (`verifyEligibility.ts`: real proof check + policy re-bind + nullifier guard) BEFORE `underwrite()`.
> An on-chain path also ships: `contracts/src/HonkVerifier.sol` + `EligibilityGate.sol` (deploy via
> `script/DeployEligibility.s.sol`), validated by 5 forge tests with a real proof. See
> `circuits/ZK-RESEARCH.md` → "STATUS: DONE".

## On-chain receipts / demo state (Phase 5 — DONE)
`BorrowFlow.tsx` now shows an **On-chain receipts** panel: passport id, human nullifier,
attestationRef, and the passport-mint / terms-set / claim tx hashes — each linking to Arcscan on
testnet (labelled "(local)" on the devnet). Mirrors the lender app's hash/Arcscan pattern.

## Config unification (Phase 4 — DONE)
`scripts/devnet.sh` now derives `metamask-lender/.env` + `underwriter-layer/cre-workflow/config.local.json`
from `app/.env` after `SetupLocal` runs — one source of truth. The lender app
(`metamask-lender/src/web3/{config,contracts}.ts`) reads `VITE_ARC_RPC_URL` / `VITE_TRANCHE_POOL_ADDRESS`
/ `VITE_USDC_ADDRESS` with the live Arc-testnet deployment as fallback, so local devnet and live
deploy both work without code edits.

## New env (borrower server)
`CONFIDENTIAL_AI_API_URL` / `CONFIDENTIAL_AI_API_KEY` in `app/.env.local` → switches `underwrite()`
from the local demo policy to the real Confidential AI TEE. Unset = local policy (still real terms).

## Still mock (flagged, "improve later")
- **Income ingestion** is self-reported; **TEE encryption** is Base64-mocked (beta Confidential AI
  API lacks `/v1/key`). Keep the flow real; make these real later.
- **Live CRE DON deploy** (production settle path) needs the CRE CLI + sandbox creds.

## Go live on Arc testnet (your step — needs creds)
1. Fund a deployer at https://faucet.circle.com; get live USDC + World + Chainlink-feed addresses
   (Circle MCP). Fill `contracts/.env` + `app/.env.local`.
2. `cd contracts && forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --private-key $DEPLOYER_PRIVATE_KEY`
3. Paste deployed addresses into `app/.env`, `metamask-lender/.env`, underwriter `config`.
4. `app`: `npm run dev` (borrower). `metamask-lender`: `npm run dev` (lender). Underwriter: run the
   decision step / CRE sim. Hashes then resolve to real `https://testnet.arcscan.app` links.

## Verify (green gate)
- `cd contracts && forge test` — **86** tests (money/identity/rate/default/end-to-end).
- `cd cre && npm test` — **19** tests (CRE sim, incl. income-never-leaks).
- `cd circuits && nargo test` — **2** tests; `node prove.js` — real proof gen+verify.
- `cd app && npm test` — **10** tests (Phase-3 `underwrite` decision + Phase-2 `decisionToTerms` seam mapping).
- `cd app && npm run build`; `cd metamask-lender && npm run build` — both UIs build.

## Demo evidence — real transaction hashes (what judges see)
The full borrower lifecycle emits **real, mined on-chain txs** — not simulated. Reproduce headless:
```
scripts/demo-local.sh        # boots anvil (chain 5042002), broadcasts the whole loop
```
`DemoLocal.s.sol` broadcasts 29 signed txs (deploy → tranche deposits → deployToVault → verifyAndMint
→ setTerms verdict → claim/disburse → 4 income-routed repayments). Verified with `cast receipt` —
all `status 1 (success)`, e.g. on one run: `verifyAndMint` blk 19, `setTerms` blk 20, `claim` blk 21,
`onPayout` blk 23. Outcome: $500 disbursed → repaid to $0 over 4 payouts → credit limit laddered
$500 → $750. On **live Arc testnet** the identical flow yields Arcscan-linkable hashes; the borrower
app's **On-chain receipts** panel renders each (mint / terms-set / claim) as a
`https://testnet.arcscan.app/tx/…` link, and the lender app does the same for deposits/CCTP.
