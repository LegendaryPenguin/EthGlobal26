# 03 · Circle / Arc Integration (the money layer)

This is the researched reference for everything Circle. **Read the Circle skill for a product
before coding it**, and keep the Circle MCP server connected for live addresses + SDK signatures.

## Step 0 — install Circle's tooling (highest-leverage thing in this repo)
Circle publishes LLM-optimized skills and an MCP server specifically for AI-assisted builds.

Claude Code:
```
/plugin marketplace add circlefin/skills
/plugin install circle-skills@circle
```
MCP server (live SDK signatures, contract addresses, chain IDs):
```json
{ "mcpServers": { "circle": { "url": "https://api.circle.com/v1/codegen/mcp" } } }
```
Full machine-readable index of Circle docs: `https://developers.circle.com/llms.txt`
Arc machine-readable index: `https://docs.arc.io/llms.txt`

### Which Circle skill maps to which part of our build
| Our component | Circle skill | Notes |
|---|---|---|
| Arc chain config, deploy, gas-in-USDC | `use-arc` | read first for anything Arc |
| USDC balances/transfers/approvals | `use-usdc` | 6-decimal ERC-20 patterns |
| Cross-chain lender deposits | `bridge-stablecoin` (CCTP V2 / Bridge Kit) | liquidity-hub track |
| Unified multi-chain balance + nanopayments | `use-gateway` | liquidity-hub + agentic stretch |
| Borrower/lender onboarding wallets | `use-circle-wallets` (+ user/dev/modular) | pick the right type (below) |
| Deploying/automating contracts via API | `use-smart-contract-platform` | optional; we mostly use Foundry |

## Arc — chain config (TESTNET ONLY)
| Key | Value |
|---|---|
| Network | Arc Testnet (Circle's L1, EVM-compatible, Malachite consensus, sub-second finality) |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` (choose Arc Testnet; USDC for gas, EURC for multi-currency) |
| Native gas token | **USDC** (no ETH anywhere) |
| Decimals | native gas = **18**; ERC-20 USDC = **6** (do not mix) |
| Tooling | Foundry, Hardhat, viem/wagmi, ethers — standard Solidity |
| Contract addresses | `https://docs.arc.io/arc/references/contract-addresses` (do not hardcode; verify) |

Notes: USDC is **native** on Arc (a system contract address) — that's why it can pay gas. Gas is
~$0.009/tx, dollar-denominated. Arc also has a built-in FX engine (StableFX) and a Paymaster.

### Verified Arc Testnet addresses (domain 26)
Pulled live via the Circle MCP server on 2026-06-13. These are also wired into `.env`. Still treat
the address pages / MCP as source of truth — re-verify before mainnet (there is no Arc mainnet yet).

| Contract | Address |
| --- | --- |
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| CCTP V2 `TokenMessengerV2` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP V2 `MessageTransmitterV2` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| Gateway `GatewayWallet` | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| Gateway `GatewayMinter` | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` |

CCTP V2 reminder: `depositForBurn()` now takes `destinationCaller` (bytes32), `maxFee` (uint256),
and `minFinalityThreshold` (uint32 — `1000` Fast, `2000` Standard). Prefer the **Bridge Kit SDK**
over raw contract calls (Circle's current recommendation; Fast by default).

## USDC / EURC
- Use the per-chain address pages; never hardcode:
  - USDC: `https://developers.circle.com/stablecoins/usdc-contract-addresses`
  - EURC: `https://developers.circle.com/stablecoins/eurc-contract-addresses`
- USDC = 6 decimals on EVM. EURC enables our localized-loan / FX angle (bonus).
- Quickstart (transfer USDC on EVM): `https://developers.circle.com/stablecoins/quickstarts/transfer-usdc-evm`

## LoanVault / IncomeRouter / TranchePool (Advanced Stablecoin Logic track)
These are **custom Solidity on Arc** (Foundry), using USDC (6 decimals). They implement:
- Conditional disbursement — release USDC only when a valid Chainlink attestation + approved
  `LoanRegistry` terms exist (escrow with automatic release).
- Programmable amortization — repayment schedule in code (vesting in reverse).
- Income routing — `IncomeRouter` splits an incoming payout: repayment slice → LoanVault, remainder
  → borrower (multi-step settlement).
The "Circle Forwarder" pattern referenced by the bounty ("escrow on source, release on destination
via Circle Forwarder") is the cross-chain conditional-transfer variant — optional; our core is
single-chain on Arc with cross-chain only on the lender deposit.

## Cross-chain lender deposits (Liquidity Hub track) — two valid approaches
Lenders' USDC lives on different chains; Arc is the settlement hub. Pick ONE primary mechanism:
1. **Gateway (recommended for "unified balance")** — `use-gateway`. Combines USDC across chains into
   one spendable balance; instant transfers (<500ms). Lender deposits anywhere → unified balance →
   funds the Arc pool. Docs: `https://developers.circle.com/gateway`, quickstart
   `https://developers.circle.com/gateway/quickstarts/unified-balance-evm`.
2. **CCTP V2 (burn-and-mint)** — `bridge-stablecoin`. Explicit cross-chain transfer; there's a
   ready quickstart **Ethereum → Arc**:
   `https://developers.circle.com/cctp/quickstarts/transfer-usdc-ethereum-to-arc`. Use CCTP V2
   (V1 is legacy). Use **Bridge Kit** (`@circle-fin/bridge-kit`) for the frontend, CCTP directly for
   backend. Arc's **App Kit** wraps CCTP and gives Bridge/Swap/Send/Unified-Balance:
   `https://docs.arc.io/app-kit`.
Either satisfies "capital sourced, routed, and settled across chains through a single application."
**Demo note:** run the live demo on Arc; show the cross-chain deposit via pre-funded balance or a
short clip (bridges are slow/flaky on testnet).

## Wallets / onboarding — pick the right type
Choosing guide: `https://developers.circle.com/wallets/infrastructure-models`
- **User-controlled wallets** (embedded, Web2 login: Google/Apple/email OTP/PIN) → best for
  onboarding borrowers and lenders who aren't crypto-native.
- **Developer-controlled wallets** (server-side, you hold keys) → best for automation/treasury, e.g.
  the income-routing service or a credit agent.
- **Modular wallets** (ERC-4337 smart accounts, passkeys, gasless) → best if you want gasless UX.
- **Gas Station** sponsors gas for Circle-wallet txns; **Paymaster** lets users pay gas in USDC
  (`https://developers.circle.com/paymaster`). On Arc gas is already USDC, so Paymaster matters more
  for the other-chain surfaces.

## Optional / bonus Circle pieces
- **StableFX** (`https://developers.circle.com/stablefx`) — on-Arc FX engine for multi-currency
  (USDC↔EURC). Powers localized loans (lend/repay in a borrower's currency).
- **Gateway Nanopayments + x402** (`https://developers.circle.com/gateway/nanopayments`) — gasless
  USDC down to $0.000001 via x402 + batched settlement. This is the rail for the **Agentic Economy
  stretch** (a credit agent paying per-inference). `What is x402?`:
  `https://developers.circle.com/gateway/nanopayments/concepts/x402`
- **Smart Contract Platform** (`https://developers.circle.com/contracts`) — deploy/interact/monitor
  via API + pre-audited templates (ERC-20/721/1155/Airdrop) + event monitoring. Use for quick token
  mocks or event monitoring; use Foundry for the custom LoanVault.
- **Compliance API** — sanctions/eligibility screening; supports the "compliance-ready by design"
  pitch (screen inside the CRE/AI step).

## Recommended stages of the Circle integration
1. Add Arc to viem/Foundry config (chain id 5042002, RPC), fund deployer at faucet.circle.com.
2. Deploy a trivial contract on Arc; confirm gas is paid in USDC and you can read your USDC balance
   (6 decimals). Lock in the decimals handling now.
3. Build LoanVault disbursement using USDC on Arc (single-chain). Get one approved loan paying out.
4. Build IncomeRouter split (mock a payout calling `onPayout`).
5. Add TranchePool accounting + yield waterfall.
6. Add cross-chain deposit via Gateway (or CCTP V2 Ethereum→Arc) for the liquidity-hub track.
7. (Stretch) x402 nanopayment for the credit agent.

## Key links (give these to Claude Code to fetch as needed)
- Circle dev index (LLM): https://developers.circle.com/llms.txt
- Arc index (LLM): https://docs.arc.io/llms.txt
- Circle skills repo: https://github.com/circlefin/skills
- Gateway: https://developers.circle.com/gateway
- CCTP: https://developers.circle.com/cctp · Ethereum→Arc quickstart above
- Wallets: https://developers.circle.com/wallets
- Paymaster: https://developers.circle.com/paymaster
- API reference: https://developers.circle.com/api-reference · SDKs: https://developers.circle.com/sdks
