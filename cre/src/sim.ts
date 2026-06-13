// Vouch CRE — local simulation runner (`npm run sim`).
//
// Stands in for `cre simulate ...`. Feeds two sample applications through the workflow and prints
// the verdict + the setTerms calldata that the EVM-Write capability would submit via the Forwarder.
//
// PRIVACY: we print ONLY the workflow output (verdict/terms/calldata). The income payload is never
// printed — that is the whole point. See test/privacy.test.ts for the enforced guarantee.

import { decodeFunctionData } from "viem";
import type { Address, Hex } from "viem";
import { loanRegistryAbi } from "./abi.ts";
import { onApplication } from "./workflow.ts";
import type { IncomePayload } from "./types.ts";

const LOAN_REGISTRY =
  (process.env.LOAN_REGISTRY_ADDRESS as Address | undefined) ??
  ("0x000000000000000000000000000000000000dEaD" as Address);

const strongApplicant: IncomePayload = {
  borrower: "0x1111111111111111111111111111111111111111",
  passportId: "0x" + "ab".repeat(32) as Hex,
  currency: "USDC",
  requestedPrincipal: 5_000_000_000n, // 5,000 USDC (6dp)
  monthlyIncome: [4_200_000_000n, 4_500_000_000n, 4_300_000_000n, 4_600_000_000n, 4_400_000_000n, 4_700_000_000n],
  monthlyDebt: [600_000_000n, 600_000_000n, 650_000_000n, 600_000_000n, 600_000_000n, 600_000_000n],
  historyMonths: 18,
};

const thinFileApplicant: IncomePayload = {
  borrower: "0x2222222222222222222222222222222222222222",
  passportId: "0x" + "cd".repeat(32) as Hex,
  currency: "USDC",
  requestedPrincipal: 5_000_000_000n,
  monthlyIncome: [1_000_000_000n, 200_000_000n],
  monthlyDebt: [700_000_000n, 700_000_000n],
  historyMonths: 2, // below MIN_HISTORY_MONTHS -> declined
};

function fmtUsdc(v: bigint): string {
  return (Number(v) / 1e6).toFixed(2);
}

async function run(label: string, app: IncomePayload): Promise<void> {
  const out = await onApplication(app, { loanRegistry: LOAN_REGISTRY, nowSeconds: 1_750_000_000n });

  // Prove the calldata decodes back to the same Terms (round-trip sanity).
  const decoded = decodeFunctionData({ abi: loanRegistryAbi, data: out.calldata });

  console.log(`\n=== ${label} ===`);
  console.log(`approved      : ${out.verdict.approved}`);
  console.log(`principal     : ${fmtUsdc(out.terms.principal)} USDC`);
  console.log(`aprBps        : ${out.terms.aprBps} (${(out.terms.aprBps / 100).toFixed(2)}%)`);
  console.log(`riskBand      : ${out.terms.riskBand} (${["A", "B", "C", "D", "E"][out.terms.riskBand] ?? "-"})`);
  console.log(`attestationRef: ${out.terms.attestationRef}`);
  console.log(`expiry        : ${out.terms.expiry}`);
  console.log(`target        : ${out.target}`);
  console.log(`setTerms calldata (-> Forwarder -> LoanRegistry):`);
  console.log(`  ${out.calldata}`);
  console.log(`decoded fn     : ${decoded.functionName} (round-trip OK)`);
}

async function main(): Promise<void> {
  console.log("Vouch CRE — local simulation (mock attester; no live Confidential AI / CRE CLI).");
  await run("Strong applicant", strongApplicant);
  await run("Thin-file applicant", thinFileApplicant);
  console.log("\nDone. In a real CRE run this would write each approved verdict on-chain via the Forwarder.");
}

void main();
