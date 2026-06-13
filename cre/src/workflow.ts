// Vouch CRE — the underwriting workflow (the decision-layer spine).
//
// Mirrors the CRE trigger -> callback shape. Each step is annotated with the real CRE capability
// it stands in for. Running this file as-is executes a LOCAL SIMULATION (no CRE CLI, no live
// endpoint). See README "Swap for live CRE run" for the production wiring.
//
//   1. HTTP trigger      -> borrower submits an application (HTTP trigger capability / EVM-log)
//   2. Confidential HTTP -> POST income to Confidential AI inference API (inside the TEE)
//   3. DON consensus     -> BFT agreement on the attested verdict (handled by the runtime)
//   4. EVM Write         -> signed report -> Forwarder -> LoanRegistry.setTerms(Terms)
//
// PRIVACY INVARIANT (Golden Rule #2): the raw income payload enters the callback and is handed
// ONLY to confidentialUnderwrite. Nothing downstream (logs, report, return value) carries it.

import type { Address, Hex } from "viem";
import type { IncomePayload, Terms, UnderwritingResult } from "./types.ts";
import { confidentialUnderwrite } from "./underwrite.ts";
import { buildReport } from "./buildReport.ts";

/** Trigger payload: the borrower's application as it arrives at the HTTP trigger. */
export type ApplicationTrigger = IncomePayload;

/** Runtime config the workflow needs (sourced from env / CRE secrets in production). */
export interface WorkflowConfig {
  /** LoanRegistry address on Arc (the EVM-Write target behind the Forwarder). */
  loanRegistry?: Address;
  /** Override clock for deterministic tests/sim. */
  nowSeconds?: bigint;
  ttlSeconds?: bigint;
}

/**
 * What the workflow emits. This is SAFE to log/return — verdict + encoded write only.
 * It deliberately does NOT echo the income payload.
 */
export interface WorkflowOutput {
  verdict: UnderwritingResult;
  terms: Terms;
  /** Calldata the EVM-Write capability submits through the Forwarder. */
  calldata: Hex;
  target: Address | undefined;
}

/**
 * The callback. In CRE this is registered against a trigger; here we call it directly.
 * STATELESS by design (Golden Rule / docs/04): all state arrives via the trigger payload.
 */
export async function onApplication(
  trigger: ApplicationTrigger,
  config: WorkflowConfig = {},
): Promise<WorkflowOutput> {
  // STEP 2 — Confidential HTTP. The payload is consumed here and never leaves this call.
  // REAL: confidentialUnderwrite wraps the CRE Confidential HTTP call to CONFIDENTIAL_AI_API_URL.
  const verdict = await confidentialUnderwrite(trigger);

  // STEP 3 — DON consensus. The runtime reaches BFT consensus on `verdict` across nodes.
  // In simulation this is a no-op (single executor). Nothing to do here.

  // STEP 4 — EVM Write. Build the frozen Terms + setTerms calldata for the Forwarder.
  // REAL: hand `calldata`/`terms` to cre.capabilities.evmWrite, targeting `loanRegistry`
  //       THROUGH CRE_FORWARDER_ADDRESS (which LoanRegistry.setForwarder() trusts).
  const { terms, calldata, target } = buildReport(
    { borrower: trigger.borrower, passportId: trigger.passportId },
    verdict,
    {
      loanRegistry: config.loanRegistry,
      nowSeconds: config.nowSeconds,
      ttlSeconds: config.ttlSeconds,
    },
  );

  return { verdict, terms, calldata, target };
}

/**
 * Registration shim showing the CRE trigger->callback wiring. Not executed in simulation, but
 * documents the production handler signature.
 *
 * REAL (sketch):
 *   import { cre } from "@chainlinklabs/cre-sdk"; // package name per the CRE TS SDK
 *   export default cre.workflow(() => {
 *     cre.on(cre.triggers.http({ path: "/apply" }), async (req, runtime) => {
 *       const out = await onApplication(req.body as ApplicationTrigger, {
 *         loanRegistry: runtime.env.LOAN_REGISTRY_ADDRESS as Address,
 *       });
 *       await runtime.capabilities.evmWrite({
 *         forwarder: runtime.env.CRE_FORWARDER_ADDRESS,
 *         to: out.target,
 *         data: out.calldata,
 *       });
 *       return { approved: out.verdict.approved }; // verdict only; never the payload
 *     });
 *   });
 */
export const __workflowName = "vouch-underwriter";
