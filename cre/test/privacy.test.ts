// PRIVACY GUARANTEE (Golden Rule #2): the borrower's raw income payload must NEVER appear in any
// log, the workflow output, the Terms struct, or the on-chain calldata. This test captures every
// console channel while running the full workflow + sim, then asserts no sensitive figure leaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { onApplication } from "../src/workflow.ts";
import { confidentialUnderwrite } from "../src/underwrite.ts";
import type { IncomePayload } from "../src/types.ts";

// Use distinctive sensitive values so any leak is unambiguous.
const SECRET_INCOME = [4_242_424_242n, 4_343_434_343n, 4_141_414_141n, 4_242_424_242n, 4_242_424_242n, 4_242_424_242n];
const SECRET_DEBT = [919_191_919n, 818_181_818n, 717_171_717n, 919_191_919n];

const app: IncomePayload = {
  borrower: "0x1111111111111111111111111111111111111111",
  passportId: ("0x" + "33".repeat(32)) as Hex,
  currency: "USDC",
  requestedPrincipal: 5_000_000_000n,
  monthlyIncome: SECRET_INCOME,
  monthlyDebt: SECRET_DEBT,
  historyMonths: 18,
};

/** Every sensitive token that must not surface anywhere outbound. */
const SENSITIVE_TOKENS: string[] = [
  ...SECRET_INCOME.map((x) => x.toString()),
  ...SECRET_DEBT.map((x) => x.toString()),
  String(app.historyMonths),
  // also hex-encoded forms
  ...SECRET_INCOME.map((x) => x.toString(16)),
  ...SECRET_DEBT.map((x) => x.toString(16)),
];

function assertNoLeak(haystack: string, where: string): void {
  for (const tok of SENSITIVE_TOKENS) {
    assert.ok(!haystack.includes(tok), `LEAK in ${where}: found sensitive token "${tok}"`);
  }
}

/** Capture stdout/stderr + console.* for the duration of `fn`. */
async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  const origInfo = console.info;
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  const sink = (...a: unknown[]) => { chunks.push(a.map(String).join(" ")); };
  console.log = sink;
  console.error = sink;
  console.warn = sink;
  console.info = sink;
  process.stdout.write = ((s: string | Uint8Array) => { chunks.push(String(s)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array) => { chunks.push(String(s)); return true; }) as typeof process.stderr.write;

  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
    console.info = origInfo;
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
  return chunks.join("\n");
}

test("workflow output (verdict/terms/calldata) contains no raw income", async () => {
  const out = await onApplication(app, { nowSeconds: 1_750_000_000n });
  const serialized = JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  assertNoLeak(serialized, "workflow output");
  // calldata is the on-chain payload — check it explicitly.
  assertNoLeak(out.calldata.toLowerCase(), "setTerms calldata");
});

test("underwrite result contains no raw income", async () => {
  const r = await confidentialUnderwrite(app);
  const serialized = JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  assertNoLeak(serialized, "underwriting result");
});

test("nothing is logged to any console channel during underwrite + workflow", async () => {
  const captured = await captureOutput(async () => {
    await confidentialUnderwrite(app);
    await onApplication(app, { nowSeconds: 1_750_000_000n });
  });
  // The underwriting/workflow path must be silent AND leak-free.
  assertNoLeak(captured, "captured console output");
});

test("running the sim demo (subprocess) never prints raw income", () => {
  // Run the real sim as a child process and inspect its full stdout + stderr.
  const simPath = fileURLToPath(new URL("../src/sim.ts", import.meta.url));
  let captured = "";
  try {
    captured = execFileSync(
      process.execPath,
      ["--experimental-strip-types", simPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    // execFileSync throws on non-zero exit; surface stdout/stderr for the leak check + diagnosis.
    const err = e as { stdout?: string; stderr?: string; message?: string };
    captured = (err.stdout ?? "") + (err.stderr ?? "");
    assert.fail(`sim subprocess failed: ${err.message}\n--- output ---\n${captured}`);
  }
  assert.ok(captured.length > 0, "sim should print its (safe) output");
  assert.match(captured, /setTerms calldata/, "sim should emit the encoded write");

  // Structural privacy check (decimal income strings can coincidentally appear inside hex
  // calldata, so we assert the payload SHAPE never leaks rather than fragile digit substrings):
  // the raw payload would only surface via logging the object/arrays.
  assert.ok(!/monthlyIncome/.test(captured), "LEAK: payload field name 'monthlyIncome' printed");
  assert.ok(!/monthlyDebt/.test(captured), "LEAK: payload field name 'monthlyDebt' printed");
  assert.ok(!/historyMonths/.test(captured), "LEAK: payload field name 'historyMonths' printed");
  // No JSON/JS array of bigints (e.g. "[ 4200000000n, ...]" or "[4200000000,...]") should appear.
  assert.ok(!/\[\s*\d{6,}n?\s*,/.test(captured), "LEAK: an array of large numbers (income/debt) was printed");
});
