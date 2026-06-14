// Vouch — client-side eligibility proving (Track D money-shot).
//
// The borrower proves, IN THE BROWSER, that their income clears the policy threshold and that
// they are not on the default list — WITHOUT revealing the income figure. `monthly_income` is a
// PRIVATE witness here: it is never a public input and never sent to any server.
//
// PUBLIC INPUT ORDER (load-bearing, matches circuits/src/main.nr `pub` params and the on-chain
// verifier): [threshold, default_list_root, income_commitment, nullifier].
//
// DEMO SIMPLIFICATION (documented): we prove against a fixed, issuer-published income *credential*
// (the canonical witness whose commitment is `INCOME_COMMITMENT`). Productionising means computing
// the commitment for the borrower's real figure from a signed credential — see circuits/ZK-RESEARCH.md
// and the `TODO(credential)` in the circuit. The privacy property (income is a private witness) is
// real regardless of which committed figure is used.

export const POLICY_THRESHOLD = "3000"; // u64, matches underwriting policy
export const DEFAULT_LIST_ROOT =
  "0x00f9952fe025cd3ad8ff1346fb409cdb22c9e7d5eb266d74d2e1b156a5d438ba";
export const INCOME_COMMITMENT =
  "0x0f7f3e4425c8afd3e2cf34e9c6adaae77b2dcf67036bc7e94b19080d045dca67";
export const NULLIFIER =
  "0x08fec089a359683c92d11a88c9737f282e71bd436a59611f7f15799ef844c039";

/** Public inputs as the verifier (backend or on-chain) expects them, in order. */
export interface EligibilityPublicInputs {
  threshold: string;
  defaultListRoot: string;
  incomeCommitment: string;
  nullifier: string;
}

export interface EligibilityProof {
  /** UltraHonk proof bytes, hex-encoded (0x…). */
  proofHex: string;
  /** Public inputs, hex strings, in circuit order. */
  publicInputs: string[];
  /** Structured view of the same public inputs. */
  inputs: EligibilityPublicInputs;
  /** Wall-clock proving time (ms) for the demo. */
  ms: number;
}

/** The canonical private witness. `monthly_income` NEVER leaves this module. */
function witness() {
  return {
    // PRIVATE — none of these are public inputs.
    monthly_income: "5000",
    income_blinding: "12345",
    borrower_secret: "777",
    low_neighbour: "0",
    high_neighbour: "0xFFFFFFFFFFFFFFFF",
    merkle_index_bits: [false, false, false, false, false, false, false, false],
    merkle_siblings: ["0", "0", "0", "0", "0", "0", "0", "0"],
    // PUBLIC.
    threshold: POLICY_THRESHOLD,
    default_list_root: DEFAULT_LIST_ROOT,
    income_commitment: INCOME_COMMITMENT,
    nullifier: NULLIFIER,
  };
}

function toHex(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * Generate the eligibility proof in the browser. Lazily imports the proving stack so the heavy
 * wasm is only pulled when the borrower actually clicks "prove" (keeps it out of the main bundle).
 */
export async function proveEligibility(): Promise<EligibilityProof> {
  const t0 = performance.now();

  // Lazy, browser-only imports.
  const [{ Noir }, { Barretenberg, UltraHonkBackend }] = await Promise.all([
    import("@noir-lang/noir_js"),
    import("@aztec/bb.js"),
  ]);

  const circuit = await fetch("/vouch_eligibility.json").then((r) => {
    if (!r.ok) throw new Error("could not load circuit artifact");
    return r.json();
  });

  const noir = new Noir(circuit);
  const api = await Barretenberg.new();
  const backend = new UltraHonkBackend(circuit.bytecode, api);

  const { witness: w } = await noir.execute(witness());
  const proof = await backend.generateProof(w);
  await api.destroy();

  return {
    proofHex: toHex(proof.proof),
    publicInputs: proof.publicInputs,
    inputs: {
      threshold: proof.publicInputs[0],
      defaultListRoot: proof.publicInputs[1],
      incomeCommitment: proof.publicInputs[2],
      nullifier: proof.publicInputs[3],
    },
    ms: Math.round(performance.now() - t0),
  };
}
