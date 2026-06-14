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
  "riskBand": "B",
  "denialReason": null
}
```

`denialReason` is `null` when the loan is approved. When denied, it carries a short, **generic** explanation (e.g. `"Requested amount exceeds assessed repayment capacity"`) — the enclave is instructed never to put income figures, age, country, occupation, balances, wallet addresses, or nullifiers in it, so no confidential data leaves the TEE.

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
# CRE_CONF_AI_API_KEY=<your-confidential-ai-api-key>
# CRE_WORKFLOW_HMAC_SECRET=<any-high-entropy-string>   # binds prompts to this workflow

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
    "requested_principal": "5000 USDC",
    "wallet_addresses": ["0x1234567890abcdef1234567890abcdef12345678"],
    "encrypted_identity_blob": "eyJ3b3JsZF9pZF9udWxsaWZpZXIiOiIweDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDBhYmMxMjMiLCJ6a19lbGlnaWJpbGl0eV9wcm9vZl92YWxpZCI6dHJ1ZSwiYWdlIjoyNywiY291bnRyeSI6Ik5HIiwib2NjdXBhdGlvbiI6ImZyZWVsYW5jZSBzb2Z0d2FyZSBkZXZlbG9wZXIiLCJzZWxmX3JlcG9ydGVkX3llYXJseV9pbmNvbWVfdXNkIjoxODAwMH0="
  }
}'
```

The CLI will trigger the workflow, pass the Base64 string to the real AWS Nitro Enclave, and when the AI is done, the Enclave will POST the result back to your Ngrok URL, triggering the final callback step on your local machine!

## Contract Tests

```bash
cd contracts && forge test -vvv
```

## Callback Authentication & Verifiable On-Chain Settlement

The callback endpoint is necessarily public (the attester POSTs to it), so the `settle` module never trusts the callback body directly. It re-derives every fact from authenticated sources before writing on-chain:

1. **API Integrity**: On callback, the workflow re-fetches the inference via `GET /v1/inference/:id` using the private `CONF_AI_API_KEY`, requires `status == completed`, and requires the callback's `output` to match the API's `output`. All downstream values are read from this *verified* response, not the callback.
2. **Workflow Authenticity** (`WORKFLOW_HMAC_SECRET`): At submit time the workflow embeds an integrity tag `sha256(secret | borrower)` in the prompt. At settle time it re-derives the tag from the secret and the borrower it parsed out of the *verified* prompt, and refuses to settle unless they match. Because the secret never leaves the workflow, an attacker who self-submits an inference with their own API key cannot forge a valid tag — this binds the on-chain decision to a prompt **this workflow authored**, not merely to "some completed inference that exists at the attester."
3. **Verifiable Transcript**: `transcriptHash` is taken from the enclave's `response_digest` in the verified API response (falling back to `SHA-256(verified output)`), and stored on-chain so the decision can be audited against the attester transcript.
4. **Borrower Binding (fail-closed)**: The destination `borrower` is parsed from the verified prompt; if it cannot be resolved, the workflow throws rather than falling back to a default address.
5. **On-Chain Replay Protection**: `CreditRegistry` indexes decisions by `keccak256(inferenceId)` and reverts `DuplicateInference` on any replay.

> Note: the integrity tag uses a simple keyed SHA-256, not a true HMAC, and assumes the attester API echoes the `prompt` field on `GET /v1/inference/:id`. In production the binding would move to an enclave-signed attestation verified on-chain.

## On-Chain Report Schema

```solidity
(address borrower, bool approved, string principal, string tranche, string riskBand, string denialReason, bytes32 transcriptHash, string inferenceId)
```

| Field | Type | Description |
|-------|------|-------------|
| `borrower` | `address` | Destination wallet (extracted securely from verified prompt) |
| `approved` | `bool` | AI lending decision |
| `principal` | `string` | The approved loan amount (e.g. "5000 USDC") |
| `tranche` | `string` | The tranche assigned ("Senior" or "Junior") |
| `riskBand` | `string` | The risk band ("A", "B", "C", "D") |
| `denialReason` | `string` | Short generic reason when denied; empty string when approved. Never contains confidential data |
| `transcriptHash` | `bytes32` | Cryptographic hash of the AI's full transcript (for verification) |
| `inferenceId` | `string` | The UUID from the Confidential AI Attester |
