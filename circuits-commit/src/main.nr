// Vouch — income-commitment + nullifier helper (a hash gadget run via noir_js, NOT a proof).
//
// bb.js exposes no usable pedersen, so we run THIS tiny circuit via noir_js `execute` to compute the
// two PUBLIC values the eligibility circuit binds against, from DYNAMIC inputs:
//   income_commitment = pedersen([monthly_income, blinding])            (assert #1 in eligibility)
//   nullifier         = pedersen([pedersen([borrower_secret])])         (assert #3 in eligibility)
// `borrower_secret` is derived from the borrower's WORLD ID nullifier (set client-side), so the
// eligibility proof's public nullifier is per-human and World-bound. Must match the hashing in
// ../circuits/src/main.nr exactly (pedersen_hash, same arg shapes).
use std::hash::pedersen_hash;

fn main(monthly_income: u64, blinding: Field, borrower_secret: Field) -> pub (Field, Field) {
    let income_commitment = pedersen_hash([monthly_income as Field, blinding]);
    let id_hash = pedersen_hash([borrower_secret]);
    let nullifier = pedersen_hash([id_hash]);
    (income_commitment, nullifier)
}
