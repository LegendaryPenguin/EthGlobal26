# Credit Passport — Frontend API

Base URL: `https://judge-recount-blizzard.ngrok-free.dev`
CreditRegistry (Sepolia): `0x6Bd85f012fA8d1e66B1f8d7fc5844A5b7B628186`

The flow is async: you **submit** an application and get back an `id`. The approve/deny **decision**
is written on-chain shortly after — look it up by that `id`.

---

## 1. Submit a loan application

**Request**

```
POST https://judge-recount-blizzard.ngrok-free.dev/trigger
Content-Type: application/json
```

```json
{
  "input": {
    "borrower_wallet": "0x1234567890abcdef1234567890abcdef12345678",
    "requested_principal": "5000 USDC",
    "wallet_addresses": ["0x1234567890abcdef1234567890abcdef12345678"],
    "encrypted_identity_blob": "<base64 string — see section 3>"
  }
}
```

**Response**

```json
{ "id": "019ec393-233e-757b-bf18-4c97e396c2f8", "status": "queued" }
```

Save the `id` — you use it to read the decision.

**Error response** (returned in the body, not as an HTTP error code):

```json
{ "error": "invalid_request", "detail": "..." }
```

Possible errors: `invalid_request`, `invalid_encrypted_identity`, `no_wallets_provided`,
`ai_classification_failed`.

---

## 2. Request fields

| Field | Type | Notes |
|-------|------|-------|
| `borrower_wallet` | `string` (0x) | Wallet that receives the loan. |
| `requested_principal` | `string` | Amount requested, e.g. `"5000 USDC"`. |
| `wallet_addresses` | `string[]` | Wallets to score on-chain. At least one required. |
| `encrypted_identity_blob` | `string` | Base64 identity payload — see section 3. |

---

## 3. Building `encrypted_identity_blob`

Base64-encode this JSON object (personal data goes **only** here, never in the top-level fields):

```json
{
  "world_id_nullifier": "0x...",
  "zk_eligibility_proof_valid": true,
  "age": 27,
  "country": "US",
  "occupation": "freelance software developer",
  "self_reported_yearly_income_usd": 18000
}
```

```ts
const encrypted_identity_blob = btoa(unescape(encodeURIComponent(JSON.stringify(identity))))
```

Rules: `zk_eligibility_proof_valid` must be `true` and `age` must be `>= 18`, or the loan is denied.
`self_reported_yearly_income_usd` is the main driver of approval and risk band.

---

## 4. Read the decision

The decision is written on-chain to the `CreditRegistry` contract. Poll by your `id` until
`exists` is `true`.

```ts
import { createPublicClient, http } from "viem"

const REGISTRY_ADDRESS = "0x6Bd85f012fA8d1e66B1f8d7fc5844A5b7B628186" // CreditRegistry on Sepolia
const REGISTRY_ABI = [{
  type: "function",
  name: "getDecisionByInferenceId",
  stateMutability: "view",
  inputs: [{ name: "inferenceId", type: "string" }],
  outputs: [{ name: "", type: "tuple", components: [
    { name: "borrower", type: "address" },
    { name: "approved", type: "bool" },
    { name: "principal", type: "string" },
    { name: "tranche", type: "string" },
    { name: "riskBand", type: "string" },
    { name: "denialReason", type: "string" },
    { name: "transcriptHash", type: "bytes32" },
    { name: "inferenceId", type: "string" },
    { name: "timestamp", type: "uint256" },
    { name: "exists", type: "bool" },
  ]}],
}] as const

const client = createPublicClient({ transport: http("<SEPOLIA_RPC_URL>") })

const decision = await client.readContract({
  address: REGISTRY_ADDRESS,
  abi: REGISTRY_ABI,
  functionName: "getDecisionByInferenceId",
  args: [id], // the id from the submit response
})
// poll every ~5s until decision.exists === true
```

**Decision fields**

| Field | Type | Meaning |
|-------|------|---------|
| `exists` | `bool` | `false` until the decision is written. Poll on this. |
| `approved` | `bool` | The lending decision. |
| `principal` | `string` | Approved amount, e.g. `"5000 USDC"`. Empty when denied. |
| `tranche` | `string` | `"Senior"` (lower risk) or `"Junior"` (higher risk). Empty when denied. |
| `riskBand` | `string` | `"A"` (best) … `"D"` (worst). Empty when denied. |
| `denialReason` | `string` | Short generic reason when denied (no personal data). Empty when approved. |
| `transcriptHash` | `bytes32` | Hash proving the decision came from the attested AI inference. |

---

## 5. Summary

```
POST /trigger      { input: { borrower_wallet, requested_principal, wallet_addresses, encrypted_identity_blob } }
                 → { id, status: "queued" }

read on-chain      getDecisionByInferenceId(id)   @ 0x6Bd85f012fA8d1e66B1f8d7fc5844A5b7B628186
                 → { exists, approved, principal, tranche, riskBand, denialReason, ... }
```

Risk bands: `A` (lowest risk) → `D` (highest). Tranches: `Senior` / `Junior`.
