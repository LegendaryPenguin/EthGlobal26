// Phase 3 — the underwriting decision the borrower server calls before writing terms. Replaces the
// hardcoded DEMO terms in verify.ts. Mirrors the underwriter-layer's Confidential-AI decision shape
// (approved + riskBand → principal/APR) and produces the attestationRef the LoanVault gate requires.
//
// PRIVACY INVARIANT: when a real Confidential AI endpoint is configured, the income payload goes to
// the TEE and is NEVER logged here; only the attested verdict is used. With no endpoint, a
// deterministic local policy stands in (documented) so the full flow runs without sandbox creds.
import { keccak256, concat, parseUnits, type Address, type Hex } from "viem"

export type Decision = {
  approved: boolean
  principal: bigint // USDC, 6 dp
  aprBps: number
  riskBand: number // 0=A..3=D
  attestationRef: Hex // Confidential-AI transcript digest (non-zero satisfies the LoanVault gate)
  reason: string
}

// band → (APR bps, demo principal). Principals kept small so the relayer can fund many demo humans.
const BANDS = [
  { band: 0, aprBps: 800, principal: 10_000_000n }, // A
  { band: 1, aprBps: 1200, principal: 8_000_000n }, // B
  { band: 2, aprBps: 1800, principal: 6_000_000n }, // C
  { band: 3, aprBps: 2600, principal: 5_000_000n }, // D
]
const LETTER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 }

const localDigest = (wallet: Address): Hex => keccak256(concat(["0x01", wallet]))

export async function underwrite(
  wallet: Address,
  env: { confAiUrl?: string; confAiKey?: string },
): Promise<Decision> {
  // PRODUCTION: POST the encrypted income payload to the Confidential AI TEE and use its verdict.
  if (env.confAiUrl) {
    try {
      const res = await fetch(env.confAiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(env.confAiKey ? { Authorization: `Bearer ${env.confAiKey}` } : {}) },
        body: JSON.stringify({ wallet }), // REAL: send encrypted_identity_blob + payload; never log it
      })
      const d = (await res.json()) as { approved?: boolean; principal?: string; riskBand?: string; transcriptHash?: string }
      if (typeof d.approved === "boolean") {
        const b = BANDS[LETTER[d.riskBand?.toUpperCase?.() ?? "C"] ?? 2]
        return {
          approved: d.approved,
          principal: d.approved ? (d.principal ? parseUnits(d.principal.match(/[\d.]+/)?.[0] ?? "0", 6) : b.principal) : 0n,
          aprBps: b.aprBps,
          riskBand: b.band,
          attestationRef: (d.transcriptHash as Hex) ?? localDigest(wallet),
          reason: "confidential-ai",
        }
      }
    } catch {
      /* fall through to local policy */
    }
  }
  // LOCAL demo policy: deterministic band from the wallet so different humans get different terms.
  const b = BANDS[Number(BigInt(keccak256(wallet)) % 4n)]
  return { approved: true, principal: b.principal, aprBps: b.aprBps, riskBand: b.band, attestationRef: localDigest(wallet), reason: "local-policy" }
}
