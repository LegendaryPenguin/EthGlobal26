// Vouch — client-side eligibility proving (Track D money-shot), DYNAMIC over self-reported income.
//
// The borrower proves, IN THE BROWSER, that the income they typed clears the policy threshold and
// that they're not on the default list — WITHOUT revealing the income figure. `monthly_income` is a
// PRIVATE witness: never a public input, never sent to any server.
//
// PUBLIC INPUT ORDER (load-bearing — matches circuits/src/main.nr `pub` params + verifyEligibility.ts
// + EligibilityGate.sol): [threshold, default_list_root, income_commitment, nullifier].
//
// DYNAMIC vs the old hardcoded witness:
//   - income_commitment is computed in-browser (commit.json helper) from the TYPED income + a fresh
//     blinding, so the circuit's `pedersen(income, blinding) == income_commitment` holds for the real
//     number.
//   - the public `nullifier` is derived from the borrower's WORLD ID nullifier (passed in), so the
//     proof is per-human and bound to the same identity that holds the passport (the helper computes
//     `pedersen(pedersen(borrower_secret))`, matching the circuit's nullifier derivation).
//
// HONESTY: income is SELF-REPORTED, so the commitment is self-minted — this is a PRIVACY gate
// (income hidden) + not-on-default-list + one-human nullifier, NOT income anti-fraud. The TEE/CRE
// underwriter handles fraud. (Issuer-signed credential = TODO(credential) in the circuit.)
//
// UNITS: reconciled to YEARLY. The wizard collects yearly income; `threshold` is the yearly bar
// (12000). The circuit param is named `monthly_income` (legacy) but the comparison is unit-agnostic;
// we feed yearly on both sides consistently.

export const POLICY_THRESHOLD = "12000"; // yearly USD bar (u64). Mirror in verifyEligibility.ts.
export const DEFAULT_LIST_ROOT =
  "0x00f9952fe025cd3ad8ff1346fb409cdb22c9e7d5eb266d74d2e1b156a5d438ba"; // root of low=0/siblings=0 demo tree

export interface EligibilityPublicInputs {
  threshold: string;
  defaultListRoot: string;
  incomeCommitment: string;
  nullifier: string;
}

export interface EligibilityProof {
  proofHex: string;
  publicInputs: string[];
  inputs: EligibilityPublicInputs;
  ms: number;
}

export interface ProveOpts {
  /** Self-reported YEARLY income (USD). The private witness — never leaves this module. */
  incomeYearly: number;
  /** The borrower's World ID nullifier (hex) — binds the proof to this human. */
  worldNullifier: string;
}

function toHex(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A fresh 31-byte blinding (stays under the BN254 field modulus). */
function randomBlinding(): string {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  return toHex(b);
}

// BN254 scalar field modulus — every Field value fed to the Noir circuit must be < this.
const BN254_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field-normalise the World nullifier into a valid BN254 Field for the circuit's borrower_secret.
 * A World ID session nullifier is a full 256-bit value that can EXCEED the field modulus (~2^254),
 * which the prover rejects ("exceeds field modulus"). Reducing mod the modulus keeps it deterministic
 * per human (same nullifier -> same secret), so the proof stays bound to the same identity.
 */
function secretFromWorldNullifier(worldNullifier: string): string {
  const raw = BigInt(worldNullifier && worldNullifier.length ? worldNullifier : "0");
  return "0x" + (raw % BN254_FIELD_MODULUS).toString(16);
}

let _eligCircuit: Promise<{ bytecode: string }> | null = null;
function loadEligibilityCircuit(): Promise<{ bytecode: string }> {
  if (!_eligCircuit) {
    _eligCircuit = fetch("/vouch_eligibility.json").then((r) => {
      if (!r.ok) throw new Error("could not load eligibility circuit artifact");
      return r.json();
    });
  }
  return _eligCircuit;
}
let _commitCircuit: Promise<unknown> | null = null;
function loadCommitCircuit(): Promise<unknown> {
  if (!_commitCircuit) {
    _commitCircuit = fetch("/commit.json").then((r) => {
      if (!r.ok) throw new Error("could not load commit helper artifact");
      return r.json();
    });
  }
  return _commitCircuit;
}

/**
 * Compute the two PUBLIC field values the eligibility circuit binds against — income_commitment and
 * nullifier — from the dynamic (income, blinding, borrower_secret), by EXECUTING the commit helper
 * circuit (no proof; just the hash gadget). Matches the circuit's own pedersen derivation.
 */
async function computeCommitAndNullifier(
  income: number,
  blinding: string,
  borrowerSecret: string,
): Promise<{ incomeCommitment: string; nullifier: string }> {
  const { Noir } = await import("@noir-lang/noir_js");
  const circuit = await loadCommitCircuit();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noir = new Noir(circuit as any);
  const { returnValue } = await noir.execute({
    monthly_income: String(income),
    blinding,
    borrower_secret: borrowerSecret,
  });
  const arr = Array.isArray(returnValue) ? (returnValue as string[]) : [String(returnValue)];
  if (arr.length < 2) throw new Error("commit helper returned unexpected shape");
  return { incomeCommitment: arr[0], nullifier: arr[1] };
}

/** Pre-warm the proving stack (call on page mount so "Apply" doesn't pay the cold-load tax). */
export async function warmupProver(): Promise<void> {
  await Promise.all([
    import("@noir-lang/noir_js"),
    import("@aztec/bb.js"),
    loadEligibilityCircuit(),
    loadCommitCircuit(),
  ]).catch(() => {});
}

/**
 * Generate the eligibility proof in the browser over the borrower's typed income.
 * Throws if income < threshold (the circuit's `assert(income >= threshold)` fails in noir.execute) —
 * the caller turns that into an honest "you don't meet the bar".
 */
export async function proveEligibility(opts: ProveOpts): Promise<EligibilityProof> {
  const t0 = performance.now();
  const income = Math.max(0, Math.floor(opts.incomeYearly));
  const blinding = randomBlinding();
  const borrowerSecret = secretFromWorldNullifier(opts.worldNullifier);

  const { incomeCommitment, nullifier } = await computeCommitAndNullifier(income, blinding, borrowerSecret);

  const [{ Noir }, { Barretenberg, UltraHonkBackend }] = await Promise.all([
    import("@noir-lang/noir_js"),
    import("@aztec/bb.js"),
  ]);
  const circuit = await loadEligibilityCircuit();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noir = new Noir(circuit as any);
  const api = await Barretenberg.new();
  const backend = new UltraHonkBackend(circuit.bytecode, api);

  // monthly_income carries the (yearly) figure — PRIVATE. If income < threshold, execute throws.
  const { witness: w } = await noir.execute({
    monthly_income: String(income),
    income_blinding: blinding,
    borrower_secret: borrowerSecret,
    low_neighbour: "0",
    high_neighbour: "0xFFFFFFFFFFFFFFFF",
    merkle_index_bits: [false, false, false, false, false, false, false, false],
    merkle_siblings: ["0", "0", "0", "0", "0", "0", "0", "0"],
    threshold: POLICY_THRESHOLD,
    default_list_root: DEFAULT_LIST_ROOT,
    income_commitment: incomeCommitment,
    nullifier,
  });
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

/** Verify a proof IN THE BROWSER with the same UltraHonk verifier the backend / chain uses. */
export async function verifyEligibilityProof(proofHex: string, publicInputs: string[]): Promise<boolean> {
  const { Barretenberg, UltraHonkBackend } = await import("@aztec/bb.js");
  const circuit = await loadEligibilityCircuit();
  const api = await Barretenberg.new();
  try {
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    return await backend.verifyProof({ proof: fromHex(proofHex), publicInputs });
  } catch {
    return false;
  } finally {
    await api.destroy();
  }
}

/** Forge attempt for the demo: flip one byte. A sound system rejects this with overwhelming prob. */
export function tamperProofHex(proofHex: string): string {
  const bytes = fromHex(proofHex);
  const i = Math.floor(bytes.length / 2);
  bytes[i] ^= 0xff;
  return toHex(bytes);
}
