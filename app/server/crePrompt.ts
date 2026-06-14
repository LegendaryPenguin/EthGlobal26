// Faithful server-side port of the Chainlink CRE underwriting prompt + integrity binding
// (origin/stage-1-underwriter:underwriter-layer/cre-workflow/{prompts.ts,modules/integrity.ts}).
//
// We replicate it byte-for-byte so we can submit the inference DIRECTLY to Confidential AI
// (the deployed CRE /trigger returns an empty async ack and never hands back the inference id).
// The live CRE workflow still owns settlement: Confidential AI calls back to cre_callback.url
// (the CRE /trigger), which re-fetches the inference, RE-DERIVES this same integrity tag from
// WORKFLOW_HMAC_SECRET, and only writes CreditRegistry if it matches the tag in our prompt.
// Because we hold the same dev secret, our self-submitted inference passes that authenticity check.
import { sha256, stringToHex } from "viem";

export type WalletProfile = { walletCount: number; totalStablecoinBalanceUsdc: number };

export const SYSTEM_PROMPT =
  "You are a credit risk analyst for an undercollateralized lending protocol " +
  "serving the unbanked. You evaluate borrowers using a combination of " +
  "self-reported identity data (decrypted from a confidential blob) and " +
  "on-chain wallet evidence. Repayment capacity is judged primarily from verified " +
  "identity and income; on-chain assets are a secondary, corroborating signal, and " +
  "a thin or empty on-chain history is expected for this population and is never by " +
  "itself a reason for a poor rating. Never include wallet addresses, nullifiers, or " +
  "identifying information in your response.";

/// Binds the prompt to the workflow-held secret. The CRE settle re-derives this and rejects
/// any inference whose tag doesn't match — so this MUST use the same secret + lowercase wallet.
export function deriveIntegrityTag(secret: string, borrowerWallet: string): `0x${string}` {
  return sha256(stringToHex(`${secret}|${borrowerWallet.toLowerCase()}`));
}

export function buildClassificationPrompt(
  profile: WalletProfile,
  encryptedIdentityBlob: string,
  borrowerWallet: string,
  requestedPrincipal: string,
  integrityTag: string,
): string {
  const profileJson = JSON.stringify(
    {
      wallet_count: profile.walletCount,
      total_stablecoin_balance_usdc: profile.totalStablecoinBalanceUsdc,
    },
    null,
    2,
  );

  return (
    `Borrower wallet: ${borrowerWallet}\n` +
    `Requested principal: ${requestedPrincipal}\n` +
    `Workflow integrity tag: ${integrityTag}\n\n` +
    `You have received an encrypted identity blob from the frontend:\n` +
    `${encryptedIdentityBlob}\n\n` +
    `[ENCLAVE INSTRUCTION: In production, you would decrypt this RSA ciphertext using your TEE private key. ` +
    `Because this is a hackathon demo, the frontend has Base64-encoded a JSON object. ` +
    `Please Base64-decode the blob above. It contains the following fields:\n` +
    `  - world_id_nullifier: the user's World ID proof of unique humanity\n` +
    `  - zk_eligibility_proof_valid: boolean confirming ZK proof passed\n` +
    `  - age: the borrower's age (must be >= 18 or reject)\n` +
    `  - country: free-text residing country name\n` +
    `  - occupation: free-text occupation string\n` +
    `  - self_reported_yearly_income_usd: self-reported annual income in USD\n` +
    `Verify that zk_eligibility_proof_valid is true and age >= 18. If either check fails, set approved to false.]\n\n` +
    `Given the following on-chain wallet profile:\n\n` +
    `${profileJson}\n\n` +
    `Classify this borrower for an undercollateralized credit facility.\n\n` +
    `IMPORTANT CONTEXT: This protocol serves the unbanked and the crypto-curious. Many creditworthy ` +
    `borrowers have little or no on-chain history yet. A low or zero on-chain stablecoin balance is ` +
    `EXPECTED and must NOT, by itself, drive a poor rating or a denial.\n\n` +
    `Assess these factors, in order of importance:\n` +
    `1. Eligibility (hard gate): age must be >= 18 and zk_eligibility_proof_valid must be true, else deny.\n` +
    `2. Income & repayment capacity (PRIMARY): does self_reported_yearly_income_usd comfortably cover the ` +
    `requested principal? Rule of thumb: a requested principal up to ~25% of annual income is low risk, ` +
    `up to ~50% is moderate, beyond that is high risk.\n` +
    `3. Occupation stability (PRIMARY): salaried/professional work is lower risk; informal/gig work is ` +
    `higher risk, but not disqualifying.\n` +
    `4. Jurisdiction (SECONDARY): borrowers in stable, well-regulated economies (e.g. United States, EU, ` +
    `UK, Canada) carry lower regional risk; higher-risk or sanctioned jurisdictions raise it.\n` +
    `5. On-chain assets (SECONDARY / BONUS ONLY): any stablecoin balance or wallet activity is positive ` +
    `corroboration that IMPROVES the rating. Its absence is neutral, never a penalty. Do NOT treat a gap ` +
    `between self-reported income and on-chain balance as a red flag — that gap is normal for the unbanked.\n\n` +
    `Risk band rubric (A = lowest risk ... D = highest risk):\n` +
    `- A: stable, verifiable income in a low-risk jurisdiction, principal small relative to income, plus some on-chain corroboration.\n` +
    `- B: stable income and/or professional occupation in a reasonable jurisdiction, principal well within capacity; on-chain assets light or moderate. (Typical band for a verified earner making a sensible request.)\n` +
    `- C: moderate or informal income, or a higher-risk jurisdiction, or a principal that is a large share of income, but still serviceable.\n` +
    `- D: weak or unverifiable signals, failed eligibility, or a principal that clearly exceeds plausible repayment capacity.\n\n` +
    `CALIBRATION: a borrower who passes eligibility and has stable, verifiable income sufficient to service ` +
    `the requested principal should land at B (and no worse than C) even with little or no on-chain balance. ` +
    `Reserve D for genuine red flags, not merely thin on-chain history.\n\n` +
    `Tranche: lower-risk borrowers (A/B) go to the Senior tranche; higher-risk borrowers (C/D) go to Junior.\n` +
    `Principal: if the requested principal is reasonable for the assessed capacity, approve and return the exact ` +
    `requested amount. If it clearly exceeds safe capacity, reject the loan entirely (approved: false).\n` +
    `- denialReason: when approved is false, give a SHORT (max ~15 words) general explanation of the main risk factor, e.g. "Requested amount exceeds assessed repayment capacity" or "Insufficient on-chain financial history". When approved is true, set it to null.\n` +
    `  CRITICAL: denialReason MUST NOT reveal any confidential or identifying data — no income figures, age, country, occupation, wallet addresses, balances, or nullifiers. Keep it generic.\n\n` +
    `Respond with ONLY a valid JSON object:\n` +
    `{\n` +
    `  "approved": true,\n` +
    `  "principal": "${requestedPrincipal}",\n` +
    `  "tranche": "Senior|Junior",\n` +
    `  "riskBand": "A|B|C|D",\n` +
    `  "denialReason": null\n` +
    `}\n` +
    `Do not include markdown formatting, code fences, or any text outside the JSON object.`
  );
}
