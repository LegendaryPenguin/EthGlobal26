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

The TEE protects the **identity-to-wallet graph** — the association between a verified human (World ID) and their wallet addresses + on-chain history. Wallet data is public on-chain, but linking it to a real human is the sensitive part. 

**Hackathon Architecture Note:** In production, the frontend uses the Nitro Enclave's public key to RSA-encrypt the World ID into an `encrypted_identity_blob`. Because the beta hackathon API does not yet expose the `/v1/key` endpoint, the frontend *mocks* this encryption by Base64-encoding the World ID. The Chainlink workflow passes this opaque blob to the AI Attester, and the AI prompt instructs the LLM to Base64-decode it before running inference!

Only the anonymized lending decision leaves the enclave:

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
│   │   ├── attest.ts              # Confidential AI Attester (TEE)
|   |   |── identity.ts            # World ID + ZK proof validation
│   │   ├── settle.ts              # ABI-encode + writeReport on-chain
│   │   └── wallet-score.ts        # EVM reads → WalletProfile
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
Unified HTTP Router -> validate(identity) -> scoreWallets(evm) -> attest(ai) -> settle(evm)
```

| Module | Capability | What It Does |
|--------|-----------|--------------|
| **Unified Router** | `HTTPTrigger` | Single webhook endpoint that routes payload to Loan App or Callback |
| **identity** | Pure logic | Validates the `encrypted_identity_blob` is present |
| **wallet-score** | `EVMClient` | Reads USDC balances on-chain for the provided wallets |
| **attest** | `HTTPClient` | Sends wallet profile + encrypted identity to Confidential AI Enclave |
| **settle** | `EVMClient` | ABI-encodes decision, writes to CreditRegistry on-chain |

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

### End-to-End Local Testing (with Ngrok)

To test the full loop locally, you can use the `--listen` server and Ngrok to receive the AI callback:

1. Run `ngrok http 2000` to get a public URL.
2. Update `creCallbackUrl` in `config.staging.json` to `https://<your-ngrok-url>.ngrok-free.dev/trigger`.
3. Start the simulator:
```bash
cre workflow simulate cre-workflow --target staging-settings --listen
```
4. Fire the loan application from PowerShell:
```powershell
Invoke-RestMethod -Uri "http://localhost:2000/trigger" -Method Post -ContentType "application/json" -Body '{
  "input": {
    "borrower_wallet": "0x1234567890abcdef1234567890abcdef12345678",
    "wallet_addresses": ["0x1234567890abcdef1234567890abcdef12345678"],
    "encrypted_identity_blob": "MHgwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDBhYmMxMjM="
  }
}'
```

The CLI will trigger the workflow, pass the Base64 string to the real AWS Nitro Enclave, and when the AI is done, the Enclave will POST the result back to your Ngrok URL, triggering the final callback step on your local machine!

## Contract Tests

```bash
cd contracts && forge test -vvv
```

## On-Chain Report Schema

```solidity
(address borrower, bool approved, string reason, bytes32 transcriptHash, string inferenceId)
```

| Field | Type | Description |
|-------|------|-------------|
| `borrower` | `address` | Destination wallet |
| `approved` | `bool` | AI lending decision |
| `reason` | `string` | The risk band (e.g. "A", "B", "C", "D") |
| `transcriptHash` | `bytes32` | Cryptographic hash of the AI's full transcript (for verification) |
| `inferenceId` | `string` | The UUID from the Confidential AI Attester |
