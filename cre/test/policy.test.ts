// Verdict / risk-policy correctness.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { evaluatePolicy, confidentialUnderwrite } from "../src/underwrite.ts";
import type { IncomePayload } from "../src/types.ts";

const PASSPORT = ("0x" + "11".repeat(32)) as Hex;
const BORROWER = "0x1111111111111111111111111111111111111111" as const;

function payload(over: Partial<IncomePayload> = {}): IncomePayload {
  return {
    borrower: BORROWER,
    passportId: PASSPORT,
    currency: "USDC",
    requestedPrincipal: 5_000_000_000n,
    monthlyIncome: [4_000_000_000n, 4_000_000_000n, 4_000_000_000n, 4_000_000_000n, 4_000_000_000n, 4_000_000_000n],
    monthlyDebt: [400_000_000n, 400_000_000n, 400_000_000n, 400_000_000n, 400_000_000n, 400_000_000n],
    historyMonths: 18,
    ...over,
  };
}

test("strong applicant approved at best band A", () => {
  const v = evaluatePolicy(payload());
  assert.equal(v.approved, true);
  assert.equal(v.riskBand, 0);
  assert.equal(v.aprBps, 800);
  assert.ok(v.principal > 0n);
});

test("declines when history below minimum", () => {
  const v = evaluatePolicy(payload({ historyMonths: 2 }));
  assert.equal(v.approved, false);
  assert.equal(v.principal, 0n);
});

test("declines when DTI exceeds max (0.45)", () => {
  const v = evaluatePolicy(
    payload({
      monthlyIncome: [1_000_000_000n, 1_000_000_000n, 1_000_000_000n, 1_000_000_000n],
      monthlyDebt: [500_000_000n, 500_000_000n, 500_000_000n, 500_000_000n], // DTI 0.5
    }),
  );
  assert.equal(v.approved, false);
});

test("worse band for higher DTI and shorter history", () => {
  const v = evaluatePolicy(
    payload({
      historyMonths: 5, // <6 => +2
      monthlyIncome: [3_000_000_000n, 3_000_000_000n, 3_000_000_000n, 3_000_000_000n],
      monthlyDebt: [900_000_000n, 900_000_000n, 900_000_000n, 900_000_000n], // DTI 0.30 => +1
    }),
  );
  assert.equal(v.approved, true);
  assert.ok(v.riskBand >= 3, `expected band >=3, got ${v.riskBand}`);
  assert.ok(v.aprBps >= 2600);
});

test("principal capped by income multiple (6x avg)", () => {
  const v = evaluatePolicy(
    payload({
      requestedPrincipal: 1_000_000_000_000n, // ask huge
      monthlyIncome: [4_000_000_000n, 4_000_000_000n, 4_000_000_000n, 4_000_000_000n, 4_000_000_000n, 4_000_000_000n],
    }),
  );
  // avg income 4,000 * 6 = 24,000 USDC cap
  assert.equal(v.principal, 4_000_000_000n * 6n);
});

test("principal never exceeds requested amount", () => {
  const v = evaluatePolicy(payload({ requestedPrincipal: 1_000_000_000n })); // ask 1,000
  assert.ok(v.principal <= 1_000_000_000n);
});

test("income volatility nudges band worse", () => {
  const steady = evaluatePolicy(
    payload({ monthlyIncome: [4_000_000_000n, 4_000_000_000n, 4_000_000_000n, 4_000_000_000n] }),
  );
  const volatile = evaluatePolicy(
    payload({ monthlyIncome: [4_000_000_000n, 4_000_000_000n, 4_000_000_000n, 1_000_000_000n] }),
  );
  assert.ok(volatile.riskBand > steady.riskBand);
});

test("confidentialUnderwrite returns a verdict with a deterministic attestationRef", async () => {
  const a = await confidentialUnderwrite(payload());
  const b = await confidentialUnderwrite(payload());
  assert.equal(a.approved, true);
  assert.match(a.attestationRef, /^0x[0-9a-f]{64}$/);
  assert.equal(a.attestationRef, b.attestationRef, "same input => same attestation hash");
});

test("declined applicant gets approved=false and band 0 in the on-chain result", async () => {
  const r = await confidentialUnderwrite(payload({ historyMonths: 1 }));
  assert.equal(r.approved, false);
  assert.equal(r.riskBand, 0); // sentinel decline band normalized to a valid uint8
  assert.equal(r.principal, 0n);
});
