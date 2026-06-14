// Vouch — backend verification of the borrower's eligibility proof (the ZK gate).
//
// This is the gate the underwriting trigger waits on: /api/world/signin verifies the proof HERE,
// BEFORE calling underwrite()/setTerms. We additionally:
//   1. re-bind policy  — the proof's public threshold + default-list root must match what OUR
//      policy currently requires (prevents replay against a stale, lower threshold / old root);
//   2. guard nullifier reuse — the circuit binds the nullifier but does NOT track reuse, so we
//      reject a second eligibility proof for the same human-key (one gate-pass per human per run).
//
// The income figure is never present here — only [threshold, defaultListRoot, incomeCommitment,
// nullifier] cross the wire. If you ever see an income value in this file, that is a privacy-thesis
// violation (docs/02 golden rule #2).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Policy the gate enforces (must match circuits/src/main.nr witness + app/src/zk/eligibility.ts).
export const POLICY_THRESHOLD = "0x0000000000000000000000000000000000000000000000000000000000000bb8"; // 3000
export const POLICY_DEFAULT_LIST_ROOT =
  "0x00f9952fe025cd3ad8ff1346fb409cdb22c9e7d5eb266d74d2e1b156a5d438ba";

export interface ProofSubmission {
  proofHex: string;
  publicInputs: string[]; // [threshold, defaultListRoot, incomeCommitment, nullifier]
}

export type GateResult =
  | { ok: true; nullifier: string }
  | { ok: false; reason: string };

// In-memory replay guard. A real deployment persists used nullifiers (or checks on-chain).
// NOTE: with the fixed DEMO witness the nullifier is shared across borrowers, so enforcement is
// OFF by default (else only one borrower could ever pass). Set ZK_ENFORCE_NULLIFIER_REPLAY=1 once
// per-human nullifiers are real (see TODO(credential) / per-session secret in eligibility.ts).
const usedNullifiers = new Set<string>();

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function eqHex(a: string, b: string): boolean {
  const norm = (x: string) => BigInt(x.startsWith("0x") ? x : "0x" + x).toString(16);
  return norm(a) === norm(b);
}

let circuitBytecodePromise: Promise<string> | null = null;
async function circuitBytecode(): Promise<string> {
  if (!circuitBytecodePromise) {
    circuitBytecodePromise = (async () => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      // Bundled into app/public for the browser; read the same artifact server-side.
      const p = path.resolve(here, "../public/vouch_eligibility.json");
      const json = JSON.parse(await readFile(p, "utf8"));
      return json.bytecode as string;
    })();
  }
  return circuitBytecodePromise;
}

/**
 * Verify an eligibility proof and enforce the policy + replay guard.
 * Returns {ok:true,nullifier} only if the proof is cryptographically valid AND policy-bound.
 */
export async function verifyEligibility(
  sub: ProofSubmission,
  opts: { enforceReplay?: boolean } = {},
): Promise<GateResult> {
  if (!sub || !sub.proofHex || !Array.isArray(sub.publicInputs) || sub.publicInputs.length !== 4) {
    return { ok: false, reason: "malformed proof submission" };
  }
  const [threshold, defaultListRoot, , nullifier] = sub.publicInputs;

  // 1. Policy re-bind (cheap checks first).
  if (!eqHex(threshold, POLICY_THRESHOLD)) return { ok: false, reason: "stale/invalid threshold" };
  if (!eqHex(defaultListRoot, POLICY_DEFAULT_LIST_ROOT)) {
    return { ok: false, reason: "stale/invalid default-list root" };
  }

  // 2. Replay guard (opt-in; see note above).
  const nKey = BigInt(nullifier).toString(16);
  if (opts.enforceReplay && usedNullifiers.has(nKey)) {
    return { ok: false, reason: "eligibility proof already used (replay)" };
  }

  // 3. Cryptographic verification under bb.js UltraHonk (matches the in-browser prover settings).
  const { Barretenberg, UltraHonkBackend } = await import("@aztec/bb.js");
  const api = await Barretenberg.new();
  try {
    const backend = new UltraHonkBackend(await circuitBytecode(), api);
    const verified = await backend.verifyProof({
      proof: hexToBytes(sub.proofHex),
      publicInputs: sub.publicInputs,
    });
    if (!verified) return { ok: false, reason: "proof failed verification" };
  } finally {
    await api.destroy();
  }

  if (opts.enforceReplay) usedNullifiers.add(nKey);
  return { ok: true, nullifier };
}
