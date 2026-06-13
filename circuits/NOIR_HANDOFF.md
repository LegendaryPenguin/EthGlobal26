# Noir / ZK Handoff — for a fresh agent (zero context)

> **Read this top-to-bottom before touching anything.** It is self-contained: it explains the
> project, the exact state of the Noir/ZK work, how well it covers the target tracks, and a ranked
> task list to close the gaps. Sources of truth referenced: `circuits/src/main.nr`,
> `circuits/prove.js`, `circuits/verify/verify.ts`, `circuits/README.md`, `docs/05-world-integration.md`,
> and the repo-root `INTEGRATION.md`.

---

## 0. What the project is (one paragraph)

**Vouch** is an undercollateralized credit protocol on **Arc** (Circle's EVM L1 testnet, chain id
`5042002`, gas paid in USDC, native USDC at `0x3600000000000000000000000000000000000000`, 6 decimals).
A borrower proves they are a unique human (**World ID**), a private AI underwrites them, and USDC is
disbursed/repaid on Arc. Lenders fund a senior/junior **TranchePool** (cross-chain via Circle
CCTP V2). Reputation is bound to the human via an **ERC-8004 passport** so defaulters can't respawn.
**Privacy thesis (golden rule):** raw income never touches the chain — only an attested verdict does.

Your job concerns the **Noir eligibility circuit** = the **privacy gate before underwriting**: the
borrower proves `income ≥ threshold AND not on a default list` **without revealing the income figure**.

---

## 1. Repo map (where the ZK work lives)

```
circuits/
  src/main.nr        THE CIRCUIT (income≥threshold + Merkle non-membership + nullifier). Strong.
  Prover.toml        example witness (income=5000, threshold=3000, etc.)
  Nargo.toml         Noir package manifest (compiler >=1.0.0, no external deps)
  prove.js           REAL proof gen + verify in Node via UltraHonk (Barretenberg). Runnable.
  verify/verify.ts   backend + on-chain verify harness — STUB (placeholder throws).
  proof.np           committed proof artifact (~2.6MB) — ProveKit format (.np)
  prover.pkp         committed ProveKit proving key
  verifier.pkv       committed ProveKit verifying key
  README.md          circuit explainer + toolchain/commands
docs/05-world-integration.md   track framing for World ID (B) + ProveKit/Noir (D)
INTEGRATION.md (repo root)      what's wired across branches; admits the ZK gate is NOT yet wired
app/                            borrower frontend (Vite/React/wagmi) + server — where the GATE belongs
contracts/                      Foundry: LoanRegistry (the seam), LoanVault, TranchePool, PassportRegistry
```

**Branches (as of this handoff):**
- `main` — integrated everything (borrower app + contracts + CRE underwriter + lender UI + circuit artifacts).
- `shiva-work` — the "real ZK proving" branch (`circuits/prove.js` + artifacts).
- `stage-2-loanvault` — borrower app + contracts + `circuits/src`.
- `frontend-metamask-lender` — lender MetaMask UI (now grafted into `main` under `metamask-lender/`).

Start from `main` (it has the integrated borrower flow you need to wire the gate into).

---

## 2. Current state — what's real vs. not (be honest in the demo)

| Piece | State |
|---|---|
| **Circuit** (`src/main.nr`) | ✅ **Strong.** Proves commitment-opening of private income, `income ≥ threshold` (range-checked), nullifier derivation (one-human key), and **non-membership** in a sorted default-list Merkle tree. Public inputs: `[threshold, defaultListRoot, incomeCommitment, nullifier]` — income is never `pub`. Has `#[test]`s (pass + below-threshold fail). Self-documents its simplifications. |
| **Proof generation** | ⚠️ **Real but Node-only.** `prove.js` generates + verifies a real proof with `@noir-lang/backend_barretenberg` **UltraHonk**. ProveKit artifacts (`.np/.pkp/.pkv`) are also committed (ProveKit *was* run separately), but the runnable in-repo path is UltraHonk, **not ProveKit**, and **not in the browser**. |
| **Verification** | ⚠️ Node verify works (in `prove.js`). `verify/verify.ts` (backend + on-chain) is a **STUB** that throws. No Solidity verifier deployed on Arc. |
| **The gate** | ❌ **Not enforced.** The borrow flow currently approves via World ID + the CRE underwriter; the ZK proof is **not required** to proceed. `INTEGRATION.md` says verbatim: *"in-browser Noir proof generation as the literal ZK gate before approval — left out of the Vite bundle for now… Wire it as the pre-`signin` gate next."* |

**Bottom line:** excellent circuit, real proof — but it sits *beside* the app, not *in* it.

---

## 3. Target tracks + current coverage

**Track D — ProveKit / Noir (~$2,500).** Requirements (from `docs/05` + `circuits/README.md`):
1. A Noir circuit: private income, public threshold. — ✅ done.
2. Compile to **R1CS**, generate **WHIR or Groth16** proof **client-side in the browser**. — ❌ Node only; runnable path is UltraHonk not ProveKit.
3. **Verify** in ≥1 target (backend or on-chain). — ⚠️ Node verify only; harness stub; no on-chain verifier.

**Aztec / Noir bounty (general).** Requirement: *Noir programs must be an **integral part** of the
application and **work in the browser**.* — ⚠️/❌ currently: neither in-browser nor integral (gate not enforced).

**Coverage estimate today: ~50–60% of Track D; weak on the Aztec "browser + integral" bar.** The
circuit clears the hard part; the unmet asks are the two the judges weight most: **browser proving**
and **the proof actually gating the app**.

---

## 4. Ranked tasks to maximize coverage (do in this order)

### TASK 1 — Wire in-browser proving as the real pre-underwriting gate  ⭐ highest leverage
Flips **both** "browser" and "integral/gate" from ❌→✅. This is the explicitly-flagged remaining piece.
- In the borrower `app/` flow (the `/signin` / `BorrowFlow.tsx` path that calls the CRE underwriter),
  generate the proof **in the browser** and **require `verified === true` before underwriting proceeds.**
- Reuse `circuits/prove.js` logic client-side (it already does `Noir.execute` → `generateProof` →
  `verifyProof`). The income inputs come from the borrower's device and **must never** be sent to a server.
- **Gotcha:** wasm bundling. `@noir-lang/noir_js` + the proving backend pull wasm; the team left it out
  of the Vite bundle to avoid build breakage. Options: lazy-`import()` the prover only when the borrower
  clicks "prove", configure `vite-plugin-wasm` + `vite-plugin-top-level-await`, and/or run proving in a
  Web Worker. Timebox it; if Vite fights you, a Web Worker with the wasm usually unblocks it.
- **Acceptance:** opening the borrow flow, entering an income, clicking "Prove eligibility" generates a
  proof in-browser, verifies it, and only then unlocks the underwriting/approval step. Income never
  leaves the device (verify in the Network tab — no income in any request).

### TASK 2 — Make the live prover ProveKit (not UltraHonk)
The track is **ProveKit**-branded; the runnable path should be ProveKit end-to-end.
- Install ProveKit (https://provekit.org/ · docs https://docs.provekit.atheon.xyz/ · benchmarks
  https://provekit.atheon.xyz/benchmarks/) and generate the proof from the compiled ACIR
  (`nargo compile` → `target/vouch_eligibility.json`).
- Choose **WHIR** for fast in-browser proving (off-chain verify) OR **Groth16** if you want the on-chain
  verifier (Task 3). The committed `.pkp/.pkv/.np` artifacts suggest ProveKit ran before — find/redo the
  exact command and **commit the generating script** (it's currently missing from the repo).
- **Gotcha:** `src/main.nr` uses `std::hash::pedersen_hash` and computes the Merkle root inline (Poseidon
  and `std::merkle` were moved out of the Noir 1.0 stdlib). If ProveKit prefers Poseidon for speed, add a
  poseidon lib to `Nargo.toml` and swap `hash2`/`hash1` — see `TODO(provekit)` in the source.

### TASK 3 — Deploy the Groth16 Solidity verifier on Arc + on-chain gate (optional but high-value)
Turns the stubbed on-chain path real and ties the ZK gate to the money layer.
- If proving with Groth16, ProveKit can emit a Solidity verifier. Deploy it to Arc testnet (Foundry,
  `contracts/`). Add a gate contract / extend the flow so `LoanRegistry.setTerms` is only reachable after
  `verifier.verifyProof(proof, publicInputs)` passes.
- **Public-input order is fixed:** `[threshold, defaultListRoot, incomeCommitment, nullifier]` — must match
  `src/main.nr`'s `pub` params exactly. See `verify/verify.ts` section (C) for the gate sketch.
- Also re-bind policy on-chain: `require(publicInputs[0]==currentThreshold)` and
  `require(publicInputs[1]==currentDefaultListRoot)` to prevent replay against a stale threshold/root.
- Arc deploy facts: chain `5042002`, RPC `https://rpc.testnet.arc.network`, explorer
  `https://testnet.arcscan.app`, gas paid in USDC. Fund the deployer at `https://faucet.circle.com`.

### TASK 4 — Close a soundness TODO for Q&A credibility (nice-to-have)
The circuit honestly flags two weaknesses (search the source for the tags):
- `TODO(credential)` — verify an **issuer signature** (EdDSA/ECDSA) over `income_commitment` so the
  commitment is attested, not self-minted. Add the signature lib to `Nargo.toml`.
- `TODO(default-list)` — upgrade non-membership from "single neighbour inclusion + `as u64` gap check"
  to a full **indexed-Merkle two-neighbour** proof (the `as u64` truncation currently weakens soundness).
Doing even one materially strengthens the "is this actually sound?" answer.

---

## 5. Toolchain setup (nothing is installed in the workspace by default)

```bash
# Noir compiler (nargo)
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup && nargo --version          # expect >= 1.0.0

cd circuits
nargo check                        # type/constraint check
nargo test                         # runs the #[test]s (pass + below-threshold fail)
nargo compile                      # -> target/vouch_eligibility.json (ACIR)

# Real proof gen + verify in Node (current path):
npm install                        # installs @noir-lang/noir_js + backend_barretenberg
node prove.js                      # "Verified: true" — income proven private

# ProveKit (Task 2): follow https://docs.provekit.atheon.xyz/ — install in an ISOLATED package,
# do NOT npm-install into the shared workspace node_modules.
```

**Prover.toml gotcha:** three public fields are hash outputs the circuit recomputes, so they can't be
hand-picked — `income_commitment = pedersen_hash([income, blinding])`, `default_list_root =
compute_merkle_root(...)`, `nullifier = pedersen_hash([pedersen_hash([borrower_secret])])`. The
`#[test]` computes them self-consistently; copy values from there or `std::println` them via `nargo execute`.

---

## 6. Definition of done (what "good track coverage" looks like)

- [ ] Borrower generates the eligibility proof **in the browser**; income never hits the network.
- [ ] Proof verification **gates** the flow — no approval/underwriting without a valid proof.
- [ ] The runnable prover is **ProveKit** (WHIR or Groth16), and the generating command is committed.
- [ ] At least one verify target is real (backend endpoint OR on-chain Groth16 verifier on Arc) — not the stub.
- [ ] Demo money-shot works: prove live in-browser, show the gate open, show the income figure never leaving the device.
- [ ] (Bonus) one soundness TODO closed (issuer signature or full non-membership).

**Do NOT** make `monthly_income` a `pub` input, ever — that breaks the entire privacy thesis (golden rule
in `docs/02`). If you see income in a proof's public inputs or a network request, stop and fix it.
