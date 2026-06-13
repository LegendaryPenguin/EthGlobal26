import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address, Hex } from "viem";
import { decisionToTerms } from "../../underwriter-layer/cre-workflow/modules/settle-loanregistry";

const BORROWER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const PASSPORT_ID = ("0x" + "ab".repeat(32)) as Hex;
const ATTEST = ("0x" + "cd".repeat(32)) as Hex;
const ctx = { borrower: BORROWER, passportId: PASSPORT_ID, attestationRef: ATTEST };

test("maps an approved decision onto the frozen Terms (band B → 12% APR, 6-dp principal)", () => {
  const t = decisionToTerms({ approved: true, principal: "500 USDC", tranche: "Junior", riskBand: "B" }, ctx);
  assert.equal(t.approved, true);
  assert.equal(t.principal, 500_000_000n); // $500 at 6 dp, not 500e18
  assert.equal(t.aprBps, 1200);
  assert.equal(t.riskBand, 1);
  assert.equal(t.borrower, BORROWER);
  assert.equal(t.passportId, PASSPORT_ID);
  assert.equal(t.attestationRef, ATTEST); // the AI transcript digest flows onto the seam
  assert.ok(t.expiry > BigInt(Math.floor(Date.now() / 1000)));
});

test("a declined decision yields zero principal and approved=false", () => {
  const t = decisionToTerms({ approved: false, principal: "0", tranche: "Senior", riskBand: "D" }, ctx);
  assert.equal(t.approved, false);
  assert.equal(t.principal, 0n);
});

test("band letters map to the expected APR table and are case-insensitive", () => {
  const cases: Array<[string, number, number]> = [
    ["A", 0, 800],
    ["b", 1, 1200],
    ["C", 2, 1800],
    ["d", 3, 2600],
    ["E", 4, 3600],
  ];
  for (const [letter, band, apr] of cases) {
    const t = decisionToTerms({ approved: true, principal: "100 USDC", tranche: "Senior", riskBand: letter }, ctx);
    assert.equal(t.riskBand, band, `band for ${letter}`);
    assert.equal(t.aprBps, apr, `apr for ${letter}`);
  }
});

test("parses a bare numeric principal ('750') into 6-dp units", () => {
  const t = decisionToTerms({ approved: true, principal: "750", tranche: "Senior", riskBand: "A" }, ctx);
  assert.equal(t.principal, 750_000_000n);
});

test("unknown band defaults to C (does not throw)", () => {
  const t = decisionToTerms({ approved: true, principal: "100", tranche: "Senior", riskBand: "Z" }, ctx);
  assert.equal(t.riskBand, 2);
  assert.equal(t.aprBps, 1800);
});
