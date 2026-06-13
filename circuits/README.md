# /circuits — Noir eligibility circuit (ProveKit, Track D)

Stage 5. The **privacy gate before underwriting**: the borrower proves a fact (income ≥ threshold
AND not on a default list) without revealing the figure. Distinct from the Confidential AI — this
is a self-sovereign *claim*; the AI is an independent *judgment*. See `docs/05`.

## Track requirements (all three)
1. A **Noir** circuit: private input = income credential; public input = threshold.
2. Compile to **R1CS**, generate a **WHIR or Groth16** proof **client-side (in the browser)**.
3. **Verify** in at least one target — our backend or an on-chain verifier contract.

## Layout
```
circuits/
  Nargo.toml         package manifest (name vouch_eligibility, bin)
  Prover.toml        example witness (two public hash fields must be filled — see below)
  src/main.nr        the circuit + #[test]s
  verify/verify.ts   backend / on-chain verification harness STUB (not installed/run)
  README.md          this file
```

## What the circuit proves

| Input | Visibility | Meaning |
|---|---|---|
| `monthly_income` | **private** | the secret income figure — **never** revealed |
| `income_blinding` | private | blinding factor for the income commitment |
| `borrower_secret` | private | borrower secret; id-hash + nullifier derive from it |
| `low_neighbour`, `high_neighbour`, `merkle_index_bits`, `merkle_siblings` | private | default-list non-membership witness |
| `threshold` | public | affordability bar set by underwriting policy |
| `default_list_root` | public | Merkle root of the sorted defaulter registry |
| `income_commitment` | public | issuer-published commitment to the income |
| `nullifier` | public | borrower's one-human key (shared with Stage-4 PassportRegistry) |

Asserts: (1) `income_commitment` opens to the private income, (2) `monthly_income >= threshold`,
(3) the public `nullifier` derives from `borrower_secret`, (4) the borrower's id-hash is **not** on
the sorted default list (Merkle sorted-neighbour non-membership).

**Modeling choices (and simplifications) are documented at the top of `src/main.nr`:**
- *Hashing* = `std::hash::pedersen_hash` (Poseidon and `std::merkle` were moved out of the stdlib
  in Noir 1.0; the Merkle root is computed inline). Swap to a Poseidon lib for proving speed if
  ProveKit prefers it — `TODO(provekit)`.
- *Credential* = a pedersen **commitment** the prover opens (not yet a full issuer signature —
  `TODO(credential)` marks where issuer EdDSA/ECDSA verification plugs in).
- *Default list* = sorted Merkle tree; non-membership via a **single neighbour inclusion + gap
  check** (`TODO(default-list)` marks the upgrade to a full indexed-Merkle two-neighbour proof).
- *Income stays private* — it is never a `pub` argument.

---

## Toolchain status

> **`nargo` is NOT installed in this workspace.** These files were scaffolded to compile once the
> Noir toolchain is added; nothing below was executed here. Steps that need a toolchain are marked.

### Install (REQUIRES INSTALL) — Noir toolchain
```bash
# noirup installs nargo (the Noir compiler) + the proving backend
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup                       # installs the latest nargo; then: nargo --version
```
Quick start ref: https://noir-lang.org/docs/getting_started/quick_start

### Install (REQUIRES INSTALL) — ProveKit (client-side WHIR/Groth16 prover)
```bash
# Follow ProveKit's install guide for the browser prover + verifier packages.
# Do NOT run npm install against the shared workspace node_modules — install in
# an isolated app package (e.g. /app) or a dedicated circuits/verify package.
```
ProveKit: https://provekit.org/ · Docs: https://docs.provekit.atheon.xyz/ ·
Benchmarks/examples: https://provekit.atheon.xyz/benchmarks/

---

## Commands

### 1. Type/constraint check (REQUIRES nargo)
```bash
cd circuits
nargo check        # type-checks the circuit and generates a Prover.toml template
```

### 2. Run tests (REQUIRES nargo)
```bash
cd circuits
nargo test         # runs #[test]s in src/main.nr (happy path + below-threshold rejection)
```

### 3. Compile to ACIR/R1CS (REQUIRES nargo)
```bash
cd circuits
nargo compile      # emits target/vouch_eligibility.json (ACIR). ProveKit consumes this
                   # and lowers it to R1CS for WHIR/Groth16 proving.
```

### Filling `Prover.toml`
Three public fields are **hash outputs** the circuit recomputes, so they can't be hand-picked:
`income_commitment` (= `pedersen_hash([monthly_income, income_blinding])`),
`default_list_root` (= `compute_merkle_root(low_neighbour, merkle_index_bits, merkle_siblings)`),
and `nullifier` (= `pedersen_hash([pedersen_hash([borrower_secret])])`). Get the real values via:
```bash
# easiest: the test computes everything self-consistently
nargo test test_eligible_borrower_passes
# or print them: add std::println(...) in main and run `nargo execute`, then paste
# the printed Field values into Prover.toml.
```

### 4. Client-side proof (REQUIRES nargo + ProveKit) — runs in the BROWSER
The borrower's browser executes the witness and generates a **WHIR** (off-chain verify) or
**Groth16** (on-chain verify) proof. See `verify/verify.ts` section (A) for the reference flow.
Local smoke test:
```bash
cd circuits
nargo execute      # produces a witness from Prover.toml (proving itself is done by ProveKit)
```

### 5. Verify (REQUIRES ProveKit)
- **Backend** (WHIR or Groth16): `verify/verify.ts` section (B) — `verifyEligibilityProofBackend`
  re-binds the policy (threshold + default-list root) and verifies the proof against the exported
  verification key. This is the gate the CRE underwriting trigger waits on.
- **On-chain** (Groth16 only): `verify/verify.ts` section (C) — deploy the ProveKit-emitted
  Solidity verifier to Arc and have the gate contract call it before `LoanRegistry.setTerms`.
  Public-input order = `[threshold, defaultListRoot, incomeCommitment, nullifier]`.

---

## Wiring
The proof is the gate: the CRE trigger / `LoanRegistry` only proceeds if the proof verified.
**Money-shot:** generate the proof live in-browser; the income figure never leaves the device.

## Open TODOs (search the source for these tags)
- `TODO(credential)` in `src/main.nr` — verify a real issuer signature over the commitment.
- `TODO(default-list)` in `src/main.nr` — full indexed-Merkle two-neighbour non-membership.
- `TODO(provekit)` in `Nargo.toml`, `src/main.nr`, `verify/verify.ts` — exact ProveKit
  prover/verifier APIs, hash-gadget choice, and the Groth16 Solidity verifier export.
```
