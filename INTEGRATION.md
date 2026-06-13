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

## Wiring the underwriter into the borrower flow (Phase 3 — next)
Today `app/server/verify.ts` `/api/world/signin` **auto-approves** hardcoded terms (`DEMO_PRINCIPAL`).
To make it real: in `signin`, instead of the hardcoded `setTerms`, call the underwriter decision
(`underwriter-layer`) → `decisionToTerms` → `writeTermsToLoanRegistry`. The **ZK gate** (`shiva-work`
`prove.js`) runs client-side first; its verified result replaces the self-asserted
`zk_eligibility_proof_valid: true` flag inside the identity blob before the underwriter approves.
> Deferred deliberately: the borrower flow is being actively rewritten on trunk. Do this edit on the
> latest trunk to avoid churn — the adapter (Phase 2) is already trunk-agnostic and ready to call.

## Config unification (Phase 4)
One address set feeds all three surfaces. Extend `scripts/devnet.sh` / `SetupLocal.s.sol` to also
write `metamask-lender/.env` and the underwriter `config.*.json` alongside `app/.env`
(LoanRegistry, LoanVault, TranchePool, PassportRegistry, USDC, RPC).

## Hashes & demo state (Phase 5)
`metamask-lender/` already surfaces tx hashes + Arcscan links + real/simulated badges. Lift that
into a shared `Receipts/DemoState` panel for the borrower app: passport-mint tx + nullifier +
passportId; the `attestationRef` + `setTerms` tx; the claim/disburse tx; repayment tx; and a live
on-chain readout (standing, terms, vault outstanding, tranche balances) — each with an Arcscan link.

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
- `cd contracts && forge test` — money/identity/rate suite.
- `cd circuits && nargo test` — eligibility circuit; `node prove.js` — real proof gen+verify.
- `cd app && npm run build`; `cd metamask-lender && npm run build` — both UIs.
