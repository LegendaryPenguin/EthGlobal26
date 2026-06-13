# Credit Passport — Chainlink Layer

The orchestration spine for Credit Passport. This layer connects World ID identity, on-chain wallet scoring, and Confidential AI classification into a single CRE workflow that writes attested credit decisions on-chain.

## Architecture

```
Frontend  →  CRE HTTP Trigger  →  Validate Identity (World ID + ZK)
                                →  Score Wallets (EVM reads)
                                →  Classify Risk (Confidential AI / TEE)
                                →  Settle On-Chain (CreditRegistry)
```

### What's Confidential

The TEE protects the **identity-to-wallet graph** — the association between a verified human (World ID nullifier) and their wallet addresses + on-chain history. Wallet data is public on-chain, but linking it to a real human is the sensitive part. Only the anonymized lending decision leaves the enclave:

```json
{
  "approved": true,
  "principal": "500 USDC",
  "tranche": "Junior",
  "riskBand": "B"
}
```

## Project Structure

```
underwriter-layer/
├── cre-workflow/
│   ├── main.ts                    # Thin orchestrator
│   ├── types.ts                   # Shared types & schemas
│   ├── prompts.ts                 # AI prompt templates
│   ├── modules/
│   │   ├── identity.ts            # World ID + ZK proof validation
│   │   ├── wallet-score.ts        # EVM reads → WalletProfile
│   │   ├── attest.ts              # Confidential AI Attester (TEE)
│   │   └── settle.ts              # ABI-encode + writeReport on-chain
│   ├── package.json
│   ├── tsconfig.json
│   ├── workflow.yaml
│   ├── config.staging.json
│   └── config.production.json
├── contracts/
│   ├── src/
│   │   ├── CreditRegistry.sol     # Consumer contract
│   │   └── interfaces/
│   ├── test/
│   │   └── CreditRegistry.t.sol
│   └── foundry.toml
├── project.yaml
├── secrets.yaml
├── .env
└── .gitignore
```

## Pipeline

```
validate(identity) → scoreWallets(evm) → attest(ai) → settle(evm)
```

| Module | Capability | What It Does |
|--------|-----------|--------------|
| **identity** | Pure logic | Validates World ID nullifier + ZK eligibility proof |
| **wallet-score** | `EVMClientCapability` | Reads USDC balances on-chain, merges with frontend context |
| **attest** | `HTTPClientCapability` (runInNodeMode) | Sends wallet profile to Confidential AI Attester in TEE |
| **settle** | `EVMClientCapability` (writeReport) | ABI-encodes decision, writes to CreditRegistry on-chain |

## Prerequisites

- **Bun** ≥ 1.2.21
- **CRE CLI** — see [Getting Started](https://docs.chain.link/cre/getting-started/overview.md)
- **Foundry** — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Funded Sepolia wallet** — [faucets.chain.link](https://faucets.chain.link)
- **Confidential AI API Key** — Chainlink booth or `#partner-chainlink` Discord

## Setup

```bash
# Install workflow dependencies
cd cre-workflow && bun install && cd ..

# Configure secrets in .env
# CRE_ETH_PRIVATE_KEY=<your-sepolia-private-key>
# CONF_AI_API_KEY_VAR=<your-confidential-ai-api-key>

# Install Foundry dependencies (if not already done)
cd contracts && forge install foundry-rs/forge-std --no-commit && cd ..
```

## Simulation

### Heartbeat (cron)
```bash
cre workflow simulate cre-workflow --target staging-settings
```

### Loan Application (HTTP trigger)
```bash
cre workflow simulate cre-workflow \
  --non-interactive --trigger-index 1 \
  --http-payload '{
    "borrower_wallet": "0x1234567890abcdef1234567890abcdef12345678",
    "wallet_addresses": ["0x1234567890abcdef1234567890abcdef12345678"],
    "world_id_nullifier": "0x0000000000000000000000000000000000000000000000000000000000abc123",
    "zk_eligibility_proof_valid": true,
    "wallet_context": {
      "wallet_age_days": 365,
      "total_transactions": 150,
      "defi_protocols_used": ["Uniswap", "Aave"]
    }
  }' \
  --target staging-settings
```

## Contract Tests

```bash
cd contracts && forge test -vvv
```

## On-Chain Report Schema

```
(address borrower, bool approved, uint256 principalUsdc, bytes32 tranche, bytes32 riskBand, bytes32 worldIdNullifier)
```

| Field | Type | Description |
|-------|------|-------------|
| `borrower` | `address` | Destination wallet |
| `approved` | `bool` | AI lending decision |
| `principalUsdc` | `uint256` | Loan amount (6 decimals) |
| `tranche` | `bytes32` | `"Senior"` or `"Junior"` |
| `riskBand` | `bytes32` | `"A"`, `"B"`, `"C"`, or `"D"` |
| `worldIdNullifier` | `bytes32` | World ID unique identifier |
