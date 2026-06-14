// Generate an EVM-target (keccak + ZK) UltraHonk proof for the eligibility circuit and write it as a
// Foundry-readable fixture, so a forge test can feed it to the bb-generated HonkVerifier.verify().
import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const circuit = JSON.parse(
  readFileSync(new URL("./target/vouch_eligibility.json", import.meta.url), "utf8"),
);

const inputs = {
  monthly_income: "5000",
  income_blinding: "12345",
  borrower_secret: "777",
  low_neighbour: "0",
  high_neighbour: "0xFFFFFFFFFFFFFFFF",
  merkle_index_bits: [false, false, false, false, false, false, false, false],
  merkle_siblings: ["0", "0", "0", "0", "0", "0", "0", "0"],
  threshold: "3000",
  default_list_root: "0x00f9952fe025cd3ad8ff1346fb409cdb22c9e7d5eb266d74d2e1b156a5d438ba",
  income_commitment: "0x0f7f3e4425c8afd3e2cf34e9c6adaae77b2dcf67036bc7e94b19080d045dca67",
  nullifier: "0x08fec089a359683c92d11a88c9737f282e71bd436a59611f7f15799ef844c039",
};

function toHex(bytes) {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

const noir = new Noir(circuit);
const api = await Barretenberg.new();
const backend = new UltraHonkBackend(circuit.bytecode, api);

const { witness } = await noir.execute(inputs);
const proof = await backend.generateProof(witness, { verifierTarget: "evm" });

// Sanity: verify off-chain under the same settings before handing to Solidity.
const ok = await backend.verifyProof(proof, { verifierTarget: "evm" });
await api.destroy();
console.log("off-chain evm verify:", ok, "| publicInputs:", proof.publicInputs.length);

const outDir = new URL("../contracts/test/fixtures/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const fixture = { proof: toHex(proof.proof), publicInputs: proof.publicInputs };
writeFileSync(new URL("eligibility_proof.json", outDir), JSON.stringify(fixture, null, 2));
console.log("wrote contracts/test/fixtures/eligibility_proof.json");
console.log(ok ? "DONE-EVMPROOF-OK" : "DONE-EVMPROOF-FAIL");
process.exit(ok ? 0 : 1);
