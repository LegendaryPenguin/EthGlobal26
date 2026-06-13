// setTerms calldata encodes/decodes round-trip against the frozen ABI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, getAbiItem, toFunctionSelector } from "viem";
import type { Hex } from "viem";
import { loanRegistryAbi } from "../src/abi.ts";
import { buildTerms, encodeSetTerms, buildReport } from "../src/buildReport.ts";
import type { Terms, UnderwritingResult } from "../src/types.ts";

const verdict: UnderwritingResult = {
  approved: true,
  principal: 12_345_678_900n,
  aprBps: 1234,
  riskBand: 2,
  attestationRef: ("0x" + "ab".repeat(32)) as Hex,
};

const envelope = {
  borrower: "0x1111111111111111111111111111111111111111" as const,
  passportId: ("0x" + "22".repeat(32)) as Hex,
};

test("encoded selector matches setTerms(Terms)", () => {
  const data = encodeSetTerms(
    buildTerms(envelope, verdict, { nowSeconds: 1_750_000_000n }),
  );
  const item = getAbiItem({ abi: loanRegistryAbi, name: "setTerms" });
  const selector = toFunctionSelector(item);
  assert.ok(data.startsWith(selector), `expected calldata to start with ${selector}`);
});

test("calldata decodes back to identical Terms (round-trip)", () => {
  const terms = buildTerms(envelope, verdict, { nowSeconds: 1_750_000_000n, ttlSeconds: 3600n });
  const data = encodeSetTerms(terms);

  const decoded = decodeFunctionData({ abi: loanRegistryAbi, data });
  assert.equal(decoded.functionName, "setTerms");
  const t = decoded.args[0] as Terms;

  assert.equal(t.borrower.toLowerCase(), terms.borrower.toLowerCase());
  assert.equal(t.passportId, terms.passportId);
  assert.equal(t.principal, terms.principal);
  assert.equal(t.aprBps, terms.aprBps);
  assert.equal(t.riskBand, terms.riskBand);
  assert.equal(t.attestationRef, terms.attestationRef);
  assert.equal(t.expiry, terms.expiry);
  assert.equal(t.approved, terms.approved);
});

test("expiry = now + ttl", () => {
  const terms = buildTerms(envelope, verdict, { nowSeconds: 1000n, ttlSeconds: 60n });
  assert.equal(terms.expiry, 1060n);
});

test("rejects aprBps outside uint16", () => {
  assert.throws(() => buildTerms(envelope, { ...verdict, aprBps: 70000 }), RangeError);
});

test("rejects riskBand outside uint8", () => {
  assert.throws(() => buildTerms(envelope, { ...verdict, riskBand: 300 }), RangeError);
});

test("buildReport bundles terms + calldata + target", () => {
  const target = "0x000000000000000000000000000000000000dEaD" as const;
  const r = buildReport(envelope, verdict, { nowSeconds: 1n, loanRegistry: target });
  assert.equal(r.target, target);
  assert.equal(r.terms.principal, verdict.principal);
  assert.ok(r.calldata.startsWith("0x"));
});
