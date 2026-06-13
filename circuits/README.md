# /circuits — Noir eligibility circuit (ProveKit, Track D)

Stage 5. The **privacy gate before underwriting**: the borrower proves a fact (income ≥ threshold
AND not on a default list) without revealing the figure. Distinct from the Confidential AI — this
is a self-sovereign *claim*; the AI is an independent *judgment*. See `docs/05`.

## Track requirements (all three)
1. A **Noir** circuit: private input = signed income credential; public input = threshold.
2. Compile to **R1CS**, generate a **WHIR or Groth16** proof **client-side (in the browser)**.
3. **Verify** in at least one target — our backend or an on-chain verifier contract.

## Wiring
The proof is the gate: the CRE trigger / `LoanRegistry` only proceeds if the proof verified.
**Money-shot:** generate the proof live in-browser; the income figure never leaves the device.

## Links
- ProveKit: https://provekit.org/
- Docs: https://docs.provekit.atheon.xyz/
- Benchmarks: https://provekit.atheon.xyz/benchmarks/
