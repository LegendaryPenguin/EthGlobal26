/**
 * Vouch — Stage 5 proof verification harness (STUB, not installed/run).
 * ---------------------------------------------------------------------------
 * This file documents how a proof generated CLIENT-SIDE in the borrower's
 * browser is verified by our BACKEND, and points at the ON-CHAIN verifier path.
 * It is intentionally dependency-free pseudo-code: it will not run until the
 * ProveKit / Noir packages are installed (see circuits/README.md).
 *
 * THE GATE (docs/05): the CRE underwriting trigger / LoanRegistry only proceeds
 * if this verification returns true. The income figure is NEVER in the inputs
 * below — only the public threshold, default-list root, income commitment, and
 * nullifier cross the wire. That is the entire privacy thesis.
 *
 * ProveKit:        https://provekit.org/
 * ProveKit docs:   https://docs.provekit.atheon.xyz/
 * ---------------------------------------------------------------------------
 */

// ===========================================================================
// Public inputs — MUST match the order/shape of the `pub` params in main.nr.
// NOTE: monthly_income is deliberately ABSENT. It is private and never leaves
// the device. If you ever find income here, that is a privacy-thesis violation.
// ===========================================================================
export interface EligibilityPublicInputs {
  threshold: string; // u64 affordability bar, as decimal string
  defaultListRoot: string; // Field, hex
  incomeCommitment: string; // Field, hex (issuer-published)
  nullifier: string; // Field, hex — one-human key shared with PassportRegistry
}

export interface EligibilityProof {
  // Opaque proof bytes produced by the ProveKit prover in the browser.
  proof: Uint8Array;
  publicInputs: EligibilityPublicInputs;
}

// ===========================================================================
// (A) CLIENT-SIDE proof generation (browser) — reference only.
// ===========================================================================
// In the borrower's browser:
//
//   import { Noir } from "@noir-lang/noir_js";
//   import circuit from "../target/vouch_eligibility.json"; // nargo compile output
//   import { ProveKitBackend } from "@provekit/backend"; // TODO(provekit): exact pkg/name
//
//   const noir = new Noir(circuit);
//   const { witness } = await noir.execute({
//     monthly_income, income_blinding, borrower_secret,         // PRIVATE
//     low_neighbour, high_neighbour, merkle_index, merkle_path, // PRIVATE
//     threshold, default_list_root, income_commitment, nullifier, // PUBLIC
//   });
//   const backend = new ProveKitBackend(circuit); // WHIR or Groth16 prover
//   const proof = await backend.generateProof(witness);
//   // POST { proof, publicInputs } to the backend verify endpoint below.
//
// TODO(provekit): replace the import names/flow with the exact ProveKit browser
//   prover API (WHIR for fast client proving, or Groth16 if an on-chain Solidity
//   verifier is the target). Confirm the witness field ordering against the
//   compiled ACIR.

// ===========================================================================
// (B) BACKEND verification (our server / inside the CRE pre-check).
// ===========================================================================
export async function verifyEligibilityProofBackend(
  submission: EligibilityProof,
  expected: { threshold: bigint; defaultListRoot: string },
): Promise<boolean> {
  // 1. Re-bind policy: the proof's public threshold/root must match what OUR
  //    underwriting policy currently requires (prevents replay against a stale,
  //    lower threshold or an old default-list root).
  if (BigInt(submission.publicInputs.threshold) !== expected.threshold) return false;
  if (submission.publicInputs.defaultListRoot !== expected.defaultListRoot) return false;

  // 2. Cryptographically verify the proof against the circuit's verification key.
  //
  //   import { ProveKitVerifier } from "@provekit/backend"; // TODO(provekit)
  //   import vk from "../target/vouch_eligibility.vk";       // exported by ProveKit
  //   const verifier = new ProveKitVerifier(vk);
  //   const ok = await verifier.verify(submission.proof, submission.publicInputs);
  //   return ok;
  //
  // TODO(provekit): wire the real verifier + verification key. The block below
  //   is a placeholder so the file reads end-to-end.
  const ok = await proveKitVerifyPlaceholder(submission);

  // 3. (caller) On success, the nullifier is checked/recorded so one human's
  //    eligibility proof can't be reused across passports, then the CRE
  //    underwriting trigger / LoanRegistry.setTerms path is allowed to proceed.
  return ok;
}

// ===========================================================================
// (C) ON-CHAIN verification path (Groth16 verifier contract on Arc).
// ===========================================================================
// If proving with Groth16, ProveKit can emit a Solidity verifier. Deploy it and
// have the gate contract call it before underwriting:
//
//   // Solidity (sketch), lives in /contracts:
//   // function gate(uint[8] calldata proof, uint[4] calldata publicInputs) external {
//   //     require(eligibilityVerifier.verifyProof(proof, publicInputs), "ineligible");
//   //     require(publicInputs[0] == currentThreshold, "stale threshold");
//   //     require(publicInputs[1] == currentDefaultListRoot, "stale root");
//   //     // publicInputs = [threshold, defaultListRoot, incomeCommitment, nullifier]
//   //     _markEligible(publicInputs[3] /* nullifier */);
//   // }
//
// TODO(provekit): export the Groth16 Solidity verifier from the compiled circuit
//   and confirm the public-input encoding/ordering matches main.nr's `pub` args.
//   WHIR proofs verify off-chain (backend path B); use Groth16 for the on-chain
//   path C.

// --- placeholder so this stub type-checks conceptually; replace in (B) above ---
async function proveKitVerifyPlaceholder(_s: EligibilityProof): Promise<boolean> {
  throw new Error(
    "STUB: install ProveKit + export the verification key, then wire the real verifier. See circuits/README.md.",
  );
}
