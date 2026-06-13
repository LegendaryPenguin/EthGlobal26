// Vouch CRE — the confidential underwriting step.
//
// REAL: replace the body of `confidentialUnderwrite` with a CRE Confidential HTTP call to
//       CONFIDENTIAL_AI_API_URL (see README "Swap for live CRE run"). In production the raw
//       payload is POSTed *inside the Confidential HTTP capability / TEE* to the Chainlink
//       Confidential AI inference API, which returns a signed attestation. The DON then reaches
//       BFT consensus on the returned verdict. Here we run a deterministic mock attester so the
//       whole workflow is runnable/testable offline.
//
// PRIVACY INVARIANT (Golden Rule #2): this function is the ONLY code allowed to read raw income.
// It MUST NOT console.log / persist / emit the payload or any raw income figure. It returns only
// the verdict (approved/principal/apr/band) plus an attestation hash. Enforced by test/privacy.test.ts.

import { keccak256, stringToHex, concatHex } from "viem";
import type { Hex } from "viem";
import type { IncomePayload, UnderwritingResult } from "./types.ts";

/** Maximum DTI (debt-to-income) we will underwrite. Above this => decline. */
const MAX_DTI = 0.45;
/** Minimum months of history required to underwrite at all. */
const MIN_HISTORY_MONTHS = 3;
/** Loan capped at this multiple of average monthly net income. */
const MAX_PRINCIPAL_INCOME_MULTIPLE = 6n;

/** APR (bps) by risk band: A..E. Better band => cheaper money. */
const APR_BY_BAND = [800, 1200, 1800, 2600, 3600] as const; // 8%, 12%, 18%, 26%, 36%

/** Sentinel band used internally for declines (above the E band). */
const RISK_DECLINE = 255;

function avg(xs: bigint[]): bigint {
  if (xs.length === 0) return 0n;
  return xs.reduce((a, b) => a + b, 0n) / BigInt(xs.length);
}

/**
 * Pure risk policy. Maps private financial facts -> verdict. No I/O, no logging.
 * Kept separate from the (mock) attestation so the policy can be unit-tested directly.
 */
export function evaluatePolicy(p: IncomePayload): {
  approved: boolean;
  principal: bigint;
  aprBps: number;
  riskBand: number;
} {
  const avgIncome = avg(p.monthlyIncome);
  const avgDebt = avg(p.monthlyDebt);

  // Hard gates.
  if (p.historyMonths < MIN_HISTORY_MONTHS || avgIncome <= 0n) {
    return { approved: false, principal: 0n, aprBps: 0, riskBand: RISK_DECLINE };
  }

  // DTI as a ratio (use scaled integer math, then to float for banding only).
  const dti = Number(avgDebt) / Number(avgIncome);
  if (dti > MAX_DTI) {
    return { approved: false, principal: 0n, aprBps: 0, riskBand: RISK_DECLINE };
  }

  // Risk band from a blend of DTI and income stability (history depth).
  // Lower band index = better. Longer history and lower DTI improve the band.
  let band = 0;
  if (dti > 0.35) band += 2;
  else if (dti > 0.25) band += 1;
  if (p.historyMonths < 6) band += 2;
  else if (p.historyMonths < 12) band += 1;
  // Income volatility nudge: if min income is far below average, bump risk.
  const minIncome = p.monthlyIncome.reduce((m, x) => (x < m ? x : m), p.monthlyIncome[0]!);
  if (Number(minIncome) < Number(avgIncome) * 0.6) band += 1;
  if (band > 4) band = 4;

  // Affordability cap: principal limited by income multiple AND requested amount.
  const incomeCap = avgIncome * MAX_PRINCIPAL_INCOME_MULTIPLE;
  let principal = p.requestedPrincipal < incomeCap ? p.requestedPrincipal : incomeCap;
  // Tighten the cap for worse bands.
  if (band >= 3) principal = (principal * 70n) / 100n;
  else if (band >= 2) principal = (principal * 85n) / 100n;

  if (principal <= 0n) {
    return { approved: false, principal: 0n, aprBps: 0, riskBand: band };
  }

  return {
    approved: true,
    principal,
    aprBps: APR_BY_BAND[band]!,
    riskBand: band,
  };
}

/**
 * Compute the attestation reference. In the mock, this is a keccak256 commitment over the
 * VERDICT plus a domain tag — NOT over raw income. This means the on-chain ref reveals nothing
 * about the payload, exactly like the real confidential attestation digest. Deterministic so
 * tests can assert round-trips.
 *
 * REAL: this hash is replaced by the attestation digest returned/signed by the Confidential AI
 * endpoint inside the TEE.
 */
function mockAttestationRef(
  verdict: { approved: boolean; principal: bigint; aprBps: number; riskBand: number },
  passportId: Hex,
): Hex {
  const tag = stringToHex("VOUCH_CONFIDENTIAL_ATTESTATION_V1");
  const verdictBlob = stringToHex(
    JSON.stringify({
      approved: verdict.approved,
      principal: verdict.principal.toString(),
      aprBps: verdict.aprBps,
      riskBand: verdict.riskBand,
    }),
  );
  return keccak256(concatHex([tag, passportId, verdictBlob]));
}

/**
 * The confidential underwriting call. Takes the private income payload, returns ONLY the verdict.
 *
 * NOTE: the parameter is intentionally consumed locally and never escapes this function.
 */
export async function confidentialUnderwrite(
  incomePayload: IncomePayload,
): Promise<UnderwritingResult> {
  // REAL: replace with CRE Confidential HTTP call to CONFIDENTIAL_AI_API_URL.
  //   const resp = await cre.capabilities.confidentialHttp.post({
  //     url: env.CONFIDENTIAL_AI_API_URL,
  //     headers: { authorization: `Bearer ${env.CONFIDENTIAL_AI_API_KEY}` },
  //     body: incomePayload,           // sent INSIDE the TEE; never logged, never on a public node
  //   });
  //   return parseAttestedVerdict(resp);  // { approved, principal, aprBps, riskBand, attestationRef }
  const verdict = evaluatePolicy(incomePayload);

  const riskBand = verdict.approved ? verdict.riskBand : 0; // on-chain uint8: bands 0..4; declined => approved=false
  const attestationRef = mockAttestationRef(verdict, incomePayload.passportId);

  return {
    approved: verdict.approved,
    principal: verdict.principal,
    aprBps: verdict.aprBps,
    riskBand,
    attestationRef,
  };
}

export const _internal = { MAX_DTI, MIN_HISTORY_MONTHS, APR_BY_BAND, MAX_PRINCIPAL_INCOME_MULTIPLE };
