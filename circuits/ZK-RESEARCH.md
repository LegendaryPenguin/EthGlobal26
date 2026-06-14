# Finishing the Vouch ZK gate — research + plan

From the multi-agent research workflow (`vouch-zk-research`), with the adversarial review applied.

## Decision: bb.js UltraHonk, NOT ProveKit
UltraHonk is the only single-toolchain path that gives both **in-browser proving** and an
**on-chain EVM verifier** (`bb write_solidity_verifier` → `HonkVerifier`). ProveKit (WHIR) verifies
off-chain only and its npm/browser API is unstable. Our circuit already proves under UltraHonk.

## ⚠️ Version matrix — pin EMPIRICALLY (review caught a mismatch)
The guide's `@aztec/bb.js@3.0.0-nightly.20251104` + `bb` CLI `0.87.0` do **not** pair with
`nargo 1.0.0-beta.22`. The compatible row (per Aztec `bb-versions.json`) is bb `5.0.0-nightly.20260522`.
**Do not trust a hardcoded number** — pin by what actually generates+verifies against our compiled
`target/vouch_eligibility.json`. `bbup --nv 1.0.0-beta.22` resolves the matching `bb` CLI.

Keep in lockstep: `nargo` ↔ `@noir-lang/noir_js` ↔ `@aztec/bb.js` ↔ `bb` CLI.

## Real bug in circuits/prove.js (fix first)
- Imports deprecated `@noir-lang/backend_barretenberg` → `UltraHonkBackend` now lives in `@aztec/bb.js`.
- Passes `circuitJson` to the backend; must pass `circuitJson.bytecode`.

## Plan
1. **Standalone proof (foundation):** fix `prove.js`, install matched packages, `node prove.js` →
   confirms versions + emits a real proof+verify. (Track D: client-side gen + verify.)
2. **Backend verify:** replace the stub in `verify/verify.ts` with `UltraHonkBackend.verifyProof`,
   keeping the policy re-bind (threshold + default-list root must match current policy) and a
   nullifier-replay guard (the circuit binds the nullifier but does NOT track reuse).
3. **In-browser hook (`app/src/hooks/useProveEligibility.ts`):** lazy-load noir_js + bb.js, fetch
   `public/vouch_eligibility.json`, `noir.execute(witness)` → `backend.generateProof(witness, {keccak:true})`.
   Income + witness secrets never leave the function; only `{proof, publicInputs}` are returned.
   Vite: `vite-plugin-node-polyfills`, `optimizeDeps.exclude:['@aztec/bb.js']`, `target:'esnext'`,
   `?url` WASM imports, COOP/COEP headers for multi-threaded proving.
4. **On-chain verifier:** `bb write_vk --oracle_hash keccak` + `bb write_solidity_verifier` →
   `HonkVerifier`; deploy on Arc; an `EligibilityGate` contract checks public inputs
   `[threshold, defaultListRoot, incomeCommitment, nullifier]` (order is load-bearing + silent),
   guards nullifier reuse, then `verifier.verify(proof, pub)`.
5. **Wire the gate:** in `app/server/verify.ts` `/signin`, verify the proof (backend or on-chain)
   BEFORE calling `underwrite()` — replaces the self-asserted `zk_eligibility_proof_valid` flag.

## Confirmed-correct details
- Public-input order: `[threshold, default_list_root, income_commitment, nullifier]` everywhere.
- `{keccak:true}` on BOTH `generateProof` and the verifier (Solidity verifier needs `--oracle_hash keccak`).
  Note: `keccak:true` uses the non-ZK keccak oracle; income privacy comes from `monthly_income` being a
  **private witness** regardless — don't conflate the two.
- Solidity Honk verifier is large → compile with `--optimizer-runs 200`.
- Circuit soundness simplifications remain (unsigned commitment; low-64-bit gap truncation) — demo-fine, flag in writeup.

Sources: NoirJS tutorial (noir-lang.org/docs/tutorials/noirjs_app), Barretenberg Solidity-verifier docs,
Aztec bb-versions compatibility map, aztec-packages#18270.

---

## STATUS: DONE (this branch) — all 5 steps shipped

Toolchain installed + pinned empirically: **nargo 1.0.0-beta.22 ↔ @noir-lang/noir_js 1.0.0-beta.22 ↔
@aztec/bb.js 5.0.0-nightly.20260522 ↔ bb CLI 5.0.0-nightly.20260522** (`bbup -nv 1.0.0-beta.22`
resolves the matching `bb`). `nargo test` = 2 pass; `nargo compile` → `target/vouch_eligibility.json`.

| # | Step | Where | Validated |
|---|---|---|---|
| 1 | Standalone proof (UltraHonk) | `circuits/prove.js` | `node prove.js` → **Verified: true** (4 public inputs, income absent) |
| 2 | Backend verify + policy re-bind + replay guard | `app/server/verifyEligibility.ts` | typechecks; wired into the gate |
| 3 | In-browser proving hook | `app/src/zk/eligibility.ts`, `app/src/hooks/useProveEligibility.ts` | `app` builds; barretenberg+acvm wasm lazy-chunked |
| 4 | On-chain Groth16/Honk verifier + gate | `contracts/src/HonkVerifier.sol` (bb `-t evm --optimized`), `contracts/src/EligibilityGate.sol`, `script/DeployEligibility.s.sol` | **forge test = 5 pass** (real proof verified on-chain ~1.27M gas; policy re-bind + replay enforced) |
| 5 | Wire the gate before underwriting | `app/server/verify.ts` `/signin` | verifies the proof BEFORE `underwrite()`; `ZK_GATE_DISABLED=1` to bypass |

### Two bb.js API notes (this nightly differs from the guide)
- `UltraHonkBackend(bytecode, api)` now **requires** an explicit `api = await Barretenberg.new()`.
- Solidity/EVM proofs use `generateProof(witness, { verifierTarget: "evm" })` (keccak + ZK); the bb
  CLI uses `-t evm` (not the old `--oracle_hash keccak`).

### Reproduce (WSL, toolchain on PATH)
```bash
cd circuits && nargo compile && node prove.js            # step 1
# step 4 verifier already generated; regenerate with:
bb write_vk -b target/vouch_eligibility.json -o target/vk -t evm
bb write_solidity_verifier -k target/vk/vk -o ../contracts/src/HonkVerifier.sol -t evm --optimized
node scripts/zk-gen-evmproof.mjs                          # writes contracts/test/fixtures
cd ../contracts && forge test --match-path test/EligibilityGate.t.sol
cd ../app && npm run build && npm test
```

### Demo deploy (your step — needs faucet)
On-chain verify is the only piece needing a deploy. Fund the deployer with **testnet USDC at
https://faucet.circle.com** (Arc pays gas in USDC), then:
```bash
cd contracts && forge script script/DeployEligibility.s.sol:DeployEligibility \
  --rpc-url $ARC_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast --slow
```

### Known simplifications (demo-fine; flagged)
- In-browser proof uses the canonical income **credential** (fixed witness). Income is still a
  PRIVATE witness — never public, never sent to the server. Per-borrower commitments need a signed
  credential + in-browser pedersen (`Fr`/sync-pedersen aren't exported in this bb.js nightly).
  Because the demo nullifier is shared, the server-side replay guard is **off by default**
  (`ZK_ENFORCE_NULLIFIER_REPLAY=1` to enable); the on-chain gate enforces it unconditionally.
- Circuit soundness TODOs (unsigned commitment; low-64-bit gap) remain — see `src/main.nr`.
