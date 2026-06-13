import { Noir } from '@noir-lang/noir_js';
import { UltraHonkBackend } from '@noir-lang/backend_barretenberg';
import { readFileSync } from 'fs';

const circuitJson = JSON.parse(readFileSync('./target/vouch_eligibility.json', 'utf8'));

const inputs = {
  monthly_income: "5000",
  income_blinding: "12345",
  borrower_secret: "777",
  low_neighbour: "0",
  high_neighbour: "0xFFFFFFFFFFFFFFFF",
  merkle_index_bits: ["0","0","0","0","0","0","0","0"],
  merkle_siblings: ["0","0","0","0","0","0","0","0"],
  threshold: "3000",
  default_list_root: "0x00f9952fe025cd3ad8ff1346fb409cdb22c9e7d5eb266d74d2e1b156a5d438ba",
  income_commitment: "0x0f7f3e4425c8afd3e2cf34e9c6adaae77b2dcf67036bc7e94b19080d045dca67",
  nullifier: "0x08fec089a359683c92d11a88c9737f282e71bd436a59611f7f15799ef844c039"
};

console.log("Generating proof - income never leaves this machine...");
const noir = new Noir(circuitJson);
const backend = new UltraHonkBackend(circuitJson);

const { witness } = await noir.execute(inputs);
const proof = await backend.generateProof(witness);

console.log("Proof generated!");
const verified = await backend.verifyProof(proof);
console.log("Verified:", verified);

if (verified) {
  console.log("\nTrack D complete - income proven private, proof verified.");
  console.log("nullifier:", inputs.nullifier);
  console.log("income_commitment:", inputs.income_commitment);
}