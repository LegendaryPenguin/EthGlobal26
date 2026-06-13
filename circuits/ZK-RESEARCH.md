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
