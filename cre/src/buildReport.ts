// Vouch CRE — build the EVM-Write report.
//
// Turns the attested verdict into the frozen `Terms` struct and ABI-encodes the
// `LoanRegistry.setTerms(Terms)` call. In production the returned calldata is what the CRE
// EVM-Write capability wraps in a DON-signed report and submits THROUGH THE FORWARDER
// (CRE_FORWARDER_ADDRESS) to LoanRegistry (LOAN_REGISTRY_ADDRESS), which trusts that Forwarder.
//
// PRIVACY INVARIANT (Golden Rule #2): the only borrower-derived fields that land here are the
// verdict + attestationRef. No raw income ever reaches this module.

import { encodeFunctionData } from "viem";
import type { Address, Hex } from "viem";
import { loanRegistryAbi } from "./abi.ts";
import type { Terms, UnderwritingResult, IncomePayload } from "./types.ts";

const UINT16_MAX = 0xffff;
const UINT8_MAX = 0xff;
const UINT64_MAX = (1n << 64n) - 1n;

/** How long approved terms stay valid (CRE callbacks are stateless; expiry travels on-chain). */
export const DEFAULT_TERMS_TTL_SECONDS = 24n * 60n * 60n; // 24h

/**
 * Assemble the frozen Terms struct from the verdict.
 * `borrower`/`passportId` come from the (non-sensitive) application envelope, not the income data.
 */
export function buildTerms(
  envelope: Pick<IncomePayload, "borrower" | "passportId">,
  verdict: UnderwritingResult,
  opts: { nowSeconds?: bigint; ttlSeconds?: bigint } = {},
): Terms {
  const now = opts.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  const ttl = opts.ttlSeconds ?? DEFAULT_TERMS_TTL_SECONDS;
  const expiry = now + ttl;

  // Bounds checks against the on-chain integer widths (defensive; consensus would also catch).
  if (verdict.aprBps < 0 || verdict.aprBps > UINT16_MAX) {
    throw new RangeError(`aprBps out of uint16 range: ${verdict.aprBps}`);
  }
  if (verdict.riskBand < 0 || verdict.riskBand > UINT8_MAX) {
    throw new RangeError(`riskBand out of uint8 range: ${verdict.riskBand}`);
  }
  if (verdict.principal < 0n) {
    throw new RangeError(`principal must be non-negative: ${verdict.principal}`);
  }
  if (expiry > UINT64_MAX) {
    throw new RangeError(`expiry out of uint64 range: ${expiry}`);
  }

  return {
    borrower: envelope.borrower,
    passportId: envelope.passportId,
    principal: verdict.principal,
    aprBps: verdict.aprBps,
    riskBand: verdict.riskBand,
    attestationRef: verdict.attestationRef,
    expiry,
    approved: verdict.approved,
  };
}

/**
 * ABI-encode `setTerms(Terms)` against the frozen ABI. This is the calldata the EVM-Write
 * capability submits through the Forwarder. Returned as 0x-prefixed hex.
 */
export function encodeSetTerms(terms: Terms): Hex {
  return encodeFunctionData({
    abi: loanRegistryAbi,
    functionName: "setTerms",
    args: [terms],
  });
}

/**
 * Convenience: verdict -> { terms, calldata, target }. `target` is the LoanRegistry the Forwarder
 * will call. This bundle is exactly what the EVM-Write capability needs.
 */
export function buildReport(
  envelope: Pick<IncomePayload, "borrower" | "passportId">,
  verdict: UnderwritingResult,
  opts: { nowSeconds?: bigint; ttlSeconds?: bigint; loanRegistry?: Address } = {},
): { terms: Terms; calldata: Hex; target: Address | undefined } {
  const terms = buildTerms(envelope, verdict, opts);
  return {
    terms,
    calldata: encodeSetTerms(terms),
    target: opts.loanRegistry,
  };
}
