import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, concat, isHex, type Address } from "viem";
import { underwrite } from "../server/underwrite";

const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const VALID_APR = new Set([800, 1200, 1800, 2600]);
const VALID_PRINCIPAL = new Set(["10000000", "8000000", "6000000", "5000000"]);

test("local policy: approves with a valid band, APR and 6-dp principal", async () => {
  const d = await underwrite(WALLET, {});
  assert.equal(d.approved, true);
  assert.equal(d.reason, "local-policy");
  assert.ok(VALID_APR.has(d.aprBps), `apr ${d.aprBps}`);
  assert.ok(d.riskBand >= 0 && d.riskBand <= 3, `band ${d.riskBand}`);
  assert.ok(VALID_PRINCIPAL.has(d.principal.toString()), `principal ${d.principal}`);
});

test("attestationRef is a non-zero 32-byte hash (satisfies the LoanVault gate)", async () => {
  const d = await underwrite(WALLET, {});
  assert.ok(isHex(d.attestationRef));
  assert.equal(d.attestationRef.length, 66); // 0x + 64 hex
  assert.notEqual(d.attestationRef, "0x" + "0".repeat(64));
  // Local digest is keccak256(0x01 || wallet) — deterministic + verifiable.
  assert.equal(d.attestationRef, keccak256(concat(["0x01", WALLET])));
});

test("deterministic: same human → same terms (so re-runs are stable for the demo)", async () => {
  const a = await underwrite(WALLET, {});
  const b = await underwrite(WALLET, {});
  assert.deepEqual(
    { ...a, principal: a.principal.toString() },
    { ...b, principal: b.principal.toString() },
  );
});

test("different humans can get different bands", async () => {
  const others = [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  ] as Address[];
  const bands = new Set<number>();
  for (const w of others) bands.add((await underwrite(w, {})).riskBand);
  assert.ok(bands.size >= 2, "policy should not collapse every human to one band");
});

test("falls back to local policy when the Confidential AI endpoint is unreachable", async () => {
  // An unroutable URL → fetch throws → we must still return a valid (local) decision, not crash.
  const d = await underwrite(WALLET, { confAiUrl: "http://127.0.0.1:1/nope" });
  assert.equal(d.approved, true);
  assert.equal(d.reason, "local-policy");
});
