// Vouch — Stage 5 standalone proof gen + verify (Track D: client-side gen + verify).
//
// Runs the REAL Noir eligibility proof under bb.js UltraHonk. The income figure
// (`monthly_income`) is a PRIVATE witness — it is never a public input and never
// leaves this process. Only [threshold, default_list_root, income_commitment,
// nullifier] are public.
//
// Toolchain (pinned, see circuits/ZK-RESEARCH.md):
//   nargo 1.0.0-beta.22  <->  @noir-lang/noir_js 1.0.0-beta.22  <->  @aztec/bb.js 5.0.0-nightly.20260522
// Run:  nargo compile && node prove.js
import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { readFileSync } from "fs";

const circuit = JSON.parse(
  readFileSync(new URL("./target/vouch_eligibility.json", import.meta.url), "utf8"),
);

// Public hash fields are recomputed by the circuit; these match `nargo test print_hash_values`.
const inputs = {
  // ---- PRIVATE (never revealed) ----
  monthly_income: "5000",
  income_blinding: "12345",
  borrower_secret: "777",
  low_neighbour: "0",
  high_neighbour: "0xFFFFFFFFFFFFFFFF",
  merkle_index_bits: [false, false, false, false, false, false, false, false],
  merkle_siblings: ["0", "0", "0", "0", "0", "0", "0", "0"],
  // ---- PUBLIC ----
  threshold: "3000",
  default_list_root: "0x00f9952fe025cd3ad8ff1346fb409cdb22c9e7d5eb266d74d2e1b156a5d438ba",
  income_commitment: "0x0f7f3e4425c8afd3e2cf34e9c6adaae77b2dcf67036bc7e94b19080d045dca67",
  nullifier: "0x08fec089a359683c92d11a88c9737f282e71bd436a59611f7f15799ef844c039",
};

console.log("Generating proof — income never leaves this machine...");
const noir = new Noir(circuit);
const api = await Barretenberg.new();
const backend = new UltraHonkBackend(circuit.bytecode, api);

const { witness } = await noir.execute(inputs);
const proof = await backend.generateProof(witness);

console.log("Proof generated!");
console.log("public inputs (income absent by design):", proof.publicInputs);

const verified = await backend.verifyProof(proof);
console.log("Verified:", verified);

await api.destroy();

if (verified) {
  console.log("\nTrack D complete — income proven private, proof verified.");
  console.log("nullifier:", inputs.nullifier);
  console.log("income_commitment:", inputs.income_commitment);
}

// bb.js holds a wasm thread pool open; exit explicitly so node returns.
process.exit(verified ? 0 : 1);
