// Integration adapter (Phase 2): make the underwriter's Confidential-AI decision land on the
// trunk's FROZEN seam — `LoanRegistry.setTerms(Terms)` — instead of the underwriter's own
// `CreditRegistry`. This is the keystone that unifies the decision layer with the money layer.
//
// Two settlement paths exist:
//   • Production CRE: the DON writes a signed report through the Forwarder (see settle.ts). That
//     needs the consumer contract to decode CRE reports + the CRE CLI/DON deploy.
//   • Live demo path (this module): the underwriter (or the borrower server, which already holds the
//     forwarder/relayer key) writes `setTerms(Terms)` directly via viem. Same seam, runnable today.
//
// This module is viem-only (no @chainlink/cre-sdk dep) so it typechecks/runs without the CRE
// toolchain. The CreditDecision → Terms mapping is the contract both layers now agree on.
import {
  createWalletClient, createPublicClient, http, defineChain, parseUnits,
  type Address, type Hex,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import type { CreditDecision } from "../types"

/// The frozen seam (contracts/src/interfaces/ILoanRegistry.sol). USDC principal is 6 decimals.
export type Terms = {
  borrower: Address
  passportId: Hex
  principal: bigint // USDC, 6 dp
  aprBps: number
  riskBand: number // 0=A..n
  attestationRef: Hex // the Confidential-AI attestation digest (transcriptHash)
  expiry: bigint // unix seconds
  approved: boolean
}

const LOAN_REGISTRY_ABI = [
  { type: "function", name: "setTerms", stateMutability: "nonpayable", inputs: [{ name: "t", type: "tuple", components: [
    { name: "borrower", type: "address" }, { name: "passportId", type: "bytes32" }, { name: "principal", type: "uint256" },
    { name: "aprBps", type: "uint16" }, { name: "riskBand", type: "uint8" }, { name: "attestationRef", type: "bytes32" },
    { name: "expiry", type: "uint64" }, { name: "approved", type: "bool" }] }], outputs: [] },
] as const

// Risk band letter → (uint8 band, APR bps). Mirrors the CRE sim's banding (A best … E worst).
const BAND: Record<string, { band: number; aprBps: number }> = {
  A: { band: 0, aprBps: 800 },
  B: { band: 1, aprBps: 1200 },
  C: { band: 2, aprBps: 1800 },
  D: { band: 3, aprBps: 2600 },
  E: { band: 4, aprBps: 3600 },
}

/// Parse the AI's "500 USDC" / "500" principal string into 6-dp USDC units.
function parsePrincipal(s: string): bigint {
  const n = (s.match(/[\d.]+/)?.[0]) ?? "0"
  return parseUnits(n, 6)
}

/// Map the underwriter's Confidential-AI decision onto the trunk's Terms struct.
/// `attestationRef` is the AI attestation digest (transcriptHash) — the on-chain proof the verdict
/// came from the TEE, satisfying the LoanVault's non-zero-attestation gate.
export function decisionToTerms(
  decision: CreditDecision,
  ctx: { borrower: Address; passportId: Hex; attestationRef: Hex; termDays?: number },
): Terms {
  const band = BAND[decision.riskBand?.toUpperCase?.() ?? "C"] ?? BAND.C
  const termDays = ctx.termDays ?? 30
  return {
    borrower: ctx.borrower,
    passportId: ctx.passportId,
    principal: decision.approved ? parsePrincipal(decision.principal) : 0n,
    aprBps: band.aprBps,
    riskBand: band.band,
    attestationRef: ctx.attestationRef,
    expiry: BigInt(Math.floor(Date.now() / 1000) + termDays * 24 * 3600),
    approved: decision.approved,
  }
}

const arc = (rpc: string) =>
  defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } })

/// Write the mapped Terms to the trunk's LoanRegistry via the forwarder key (the live demo path).
/// `forwarderPk` must be the address LoanRegistry trusts as its forwarder (deployer in the devnet).
export async function writeTermsToLoanRegistry(opts: {
  rpcUrl: string
  loanRegistry: Address
  forwarderPk: Hex
  terms: Terms
}): Promise<{ txHash: Hex }> {
  const chain = arc(opts.rpcUrl)
  const account = privateKeyToAccount(opts.forwarderPk)
  const wallet = createWalletClient({ account, chain, transport: http(opts.rpcUrl) })
  const pub = createPublicClient({ chain, transport: http(opts.rpcUrl) })
  const txHash = await wallet.writeContract({
    address: opts.loanRegistry, abi: LOAN_REGISTRY_ABI, functionName: "setTerms", args: [opts.terms],
  })
  await pub.waitForTransactionReceipt({ hash: txHash })
  return { txHash }
}
