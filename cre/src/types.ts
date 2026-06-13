// Vouch CRE — shared types.
//
// PRIVACY INVARIANT (Golden Rule #2): the borrower's raw income payload (`IncomePayload`)
// is INPUT to the confidential path only. It must NEVER be logged, persisted, or written
// on-chain. Only the attested verdict (`UnderwritingResult` -> `Terms`) leaves this layer.

import type { Address, Hex } from "viem";

/**
 * The private income payload a borrower submits with their application.
 * This is the sensitive data that, in production, only ever exists inside the
 * Confidential HTTP path / TEE. Treated as a black box by everything outside underwrite.ts.
 */
export interface IncomePayload {
  /** Wallet that will receive funds. Not sensitive on its own, but kept with the payload. */
  borrower: Address;
  /** ERC-8004 identity-bound id (one per human). */
  passportId: Hex;
  /** Currency requested in, e.g. "USDC" / "EURC". Affects nothing sensitive. */
  currency: string;
  /** Requested principal in USDC 6dp (what the borrower asks for). */
  requestedPrincipal: bigint;
  /** SENSITIVE: trailing monthly net income samples (USDC 6dp), newest last. */
  monthlyIncome: bigint[];
  /** SENSITIVE: existing monthly debt obligations (USDC 6dp). */
  monthlyDebt: bigint[];
  /** SENSITIVE: months of verifiable income history. */
  historyMonths: number;
}

/** Risk bands. 0 = A (best) .. 4 = E. Above E => declined. */
export const RISK_BANDS = ["A", "B", "C", "D", "E"] as const;
export type RiskBandLabel = (typeof RISK_BANDS)[number];

/**
 * The attested verdict returned by the confidential underwriter.
 * This is the ONLY thing derived from the payload that is allowed to leave the layer.
 * It contains NO raw income figures — only the policy outcome plus an attestation hash.
 */
export interface UnderwritingResult {
  approved: boolean;
  /** Approved principal in USDC 6dp (0 if declined). */
  principal: bigint;
  /** Annual rate in basis points (e.g. 1000 = 10.00%). */
  aprBps: number;
  /** 0 = A .. 4 = E. */
  riskBand: number;
  /**
   * Hash standing in for the real Chainlink confidential attestation.
   * In production this is the attestation digest returned by the Confidential AI API,
   * which the on-chain LoanRegistry/LoanVault verifies before disbursing.
   */
  attestationRef: Hex;
}

/**
 * The frozen on-chain struct written by `LoanRegistry.setTerms(Terms)`.
 * Layout MUST match contracts/src/interfaces/ILoanRegistry.sol exactly (Golden Rule #1).
 */
export interface Terms {
  borrower: Address;
  passportId: Hex;
  /** USDC, 6 decimals. Do not mix with 18-dec gas (Golden Rule #4). */
  principal: bigint;
  /** uint16 */
  aprBps: number;
  /** uint8 */
  riskBand: number;
  attestationRef: Hex;
  /** uint64 — unix seconds. */
  expiry: bigint;
  approved: boolean;
}
