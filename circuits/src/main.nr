// Vouch — Stage 5 eligibility circuit (Noir / ProveKit, Track D)
//
// PURPOSE
//   The privacy gate BEFORE underwriting. The borrower proves, client-side in
//   the browser, two facts about themselves WITHOUT revealing the income figure:
//
//       1. monthly_income >= threshold          (affordability claim)
//       2. borrower is NOT on the default list   (good-standing claim)
//
//   This is a self-sovereign *claim* (the borrower asserts something they can
//   prove). It is distinct from the Confidential AI, which is an independent
//   *judgment* on data the borrower cannot self-attest. See docs/05.
//
// CRITICAL PRIVACY INVARIANT
//   `monthly_income` is a PRIVATE input and MUST NEVER become a public input.
//   Only the threshold, the default-list root, the income commitment, and the
//   borrower's public nullifier are revealed by the proof. The income figure
//   never leaves the device. (See docs/02 golden rule #2: on-chain = verdict.)
//
// ------------------------------------------------------------------------------
// HASH CHOICE
//   We use `std::hash::pedersen_hash` (stable in the Noir stdlib; takes a slice
//   of Field and returns a Field). NOTE: as of Noir 1.0, Poseidon and the
//   `std::merkle` helper were MOVED OUT of the stdlib into separate libraries,
//   so we deliberately (a) use pedersen from std and (b) compute the Merkle root
//   inline rather than importing `std::merkle`. To switch to Poseidon for
//   ProveKit performance, add the poseidon lib to Nargo.toml and swap `hash2`.
//   TODO(provekit): confirm whether pedersen or poseidon is the cheaper gadget
//   for the chosen ProveKit prover (WHIR/Groth16) — https://provekit.org.
//
// ------------------------------------------------------------------------------
// CREDENTIAL MODEL (what we chose, and the simplification)
// ------------------------------------------------------------------------------
//   We model the income credential as a HASH COMMITMENT the prover opens inside
//   the circuit, rather than a full signature check:
//
//       income_commitment = H(monthly_income, income_blinding)
//
//   The commitment is a PUBLIC input. The circuit re-computes the hash from the
//   private (income, blinding) and asserts it equals the public commitment,
//   binding the proof to a specific externally-published commitment. An issuer
//   (e.g. a payroll/Plaid attestation service) publishes `income_commitment`;
//   the borrower later proves a threshold over the committed value privately.
//
//   SIMPLIFICATION: a production credential would be SIGNED by a trusted issuer
//   so the verifier knows the commitment is authentic and not self-minted. Here
//   we stop at commitment-opening. The hook is marked `TODO(credential)` below:
//   verify an issuer EdDSA/ECDSA signature over `income_commitment` with the
//   issuer's public key as a public input.
//
// ------------------------------------------------------------------------------
// DEFAULT-LIST MODEL (what we chose, and the simplification)
// ------------------------------------------------------------------------------
//   The default list is a Merkle root (`default_list_root`, public). Membership
//   is a Merkle inclusion proof; we need NON-membership.
//
//   Plain non-membership isn't directly expressible without a sorted/indexed
//   tree. We use a SORTED-NEIGHBOUR non-membership check:
//       - tree leaves are the SORTED hashed ids of defaulters;
//       - the prover supplies an adjacent pair (low_leaf, high_leaf), proves
//         low_leaf is in the tree, and shows
//         low_leaf < borrower_id_hash < high_leaf. Sorted + adjacent => no leaf
//         equals borrower_id_hash => not a member.
//
//   SIMPLIFICATION (documented): the version below proves a SINGLE Merkle
//   inclusion (the low neighbour) plus a strict-inequality gap check against a
//   supplied high neighbour, rather than a full indexed-Merkle-tree gadget with
//   two independent paths proven adjacent. Sound for a sorted tree but it trusts
//   the prover supplied a genuine successor; a production build should prove
//   BOTH neighbours' inclusion and their adjacency. Marked `TODO(default-list)`.
//
// ------------------------------------------------------------------------------
// PROVEKIT NOTES
//   This is plain Noir and compiles to ACIR/R1CS with `nargo`. ProveKit then
//   produces the client-side WHIR/Groth16 proof from the compiled artifact;
//   nothing ProveKit-specific lives in the circuit. See verify/verify.ts +
//   README.md. https://provekit.org · https://docs.provekit.atheon.xyz/

use std::hash::pedersen_hash;

// Depth of the (sorted) default-list Merkle tree. Tune to your registry size.
// A depth-8 tree holds up to 256 defaulter ids; raise as needed.
global DEFAULT_LIST_DEPTH: u32 = 8;

// Two-input hash helper (commitment + Merkle node hashing).
fn hash2(a: Field, b: Field) -> Field {
    pedersen_hash([a, b])
}

// One-input hash helper (id-hash / nullifier derivation).
fn hash1(a: Field) -> Field {
    pedersen_hash([a])
}

// Recompute a Merkle root from a leaf, its path bits, and sibling hashes.
// `index_bits[i] == 0` => current node is the LEFT child at level i.
// Done inline so we don't depend on a `std::merkle` helper (removed in 1.0).
fn compute_merkle_root(
    leaf: Field,
    index_bits: [u1; 8],
    siblings: [Field; 8],
) -> Field {
    let mut node = leaf;
    for i in 0..DEFAULT_LIST_DEPTH {
        let sibling = siblings[i];
        // if bit is 0 -> node is left; else node is right
        let (left, right) = if index_bits[i] == 0 {
            (node, sibling)
        } else {
            (sibling, node)
        };
        node = hash2(left, right);
    }
    node
}

fn main(
    // ---- PRIVATE inputs (never revealed) ----------------------------------
    monthly_income: u64,            // the secret figure being proven about
    income_blinding: Field,         // blinding factor for the income commitment
    borrower_secret: Field,         // borrower's secret; id_hash derives from it

    // default-list non-membership witness (private):
    low_neighbour: Field,           // sorted-tree leaf just below borrower_id_hash
    high_neighbour: Field,          // sorted-tree leaf just above borrower_id_hash
    merkle_index_bits: [u1; 8],     // path bits of low_neighbour in the tree
    merkle_siblings: [Field; 8],    // sibling hashes proving low_neighbour ∈ tree

    // ---- PUBLIC inputs (revealed by / bound into the proof) ---------------
    threshold: pub u64,             // affordability bar set by underwriting policy
    default_list_root: pub Field,   // Merkle root of the sorted defaulter registry
    income_commitment: pub Field,   // issuer-published commitment to the income
    nullifier: pub Field,           // borrower's public id key (one-human binding)
) {
    // === 1. Open the income commitment ====================================
    // Re-derive the commitment from the private income + blinding and bind it to
    // the public commitment, proving the proof is about the committed income.
    let recomputed_commitment = hash2(monthly_income as Field, income_blinding);
    assert(recomputed_commitment == income_commitment);
    // TODO(credential): verify an issuer signature over `income_commitment` here
    //   so the verifier knows the commitment was attested, not self-minted.
    //   e.g. std::eddsa::eddsa_poseidon_verify(issuer_pk_x, issuer_pk_y, sig_s,
    //        sig_r8_x, sig_r8_y, income_commitment) with issuer_pk_* as pub inputs.

    // === 2. Affordability: monthly_income >= threshold =====================
    // u64 comparison; income stays private. `>=` lowers to range-constrained
    // comparison gates in ACIR.
    assert(monthly_income >= threshold);

    // === 3. Bind the borrower id / nullifier ===============================
    // The public `nullifier` is the one-human key (shared with the World ID
    // PassportRegistry binding in Stage 4). The id-hash used against the default
    // list is derived from the same secret so a borrower cannot prove
    // non-membership for an id that isn't theirs.
    let borrower_id_hash = hash1(borrower_secret);
    let derived_nullifier = hash1(borrower_id_hash);
    assert(derived_nullifier == nullifier);

    // === 4. Default-list NON-membership (sorted-neighbour proof) ===========
    // Prove `low_neighbour` is in the sorted tree, then prove the borrower's id
    // hash falls strictly inside the (low_neighbour, high_neighbour) gap. Because
    // the tree is sorted, no leaf can equal borrower_id_hash => not on the list.
    let computed_root =
        compute_merkle_root(low_neighbour, merkle_index_bits, merkle_siblings);
    assert(computed_root == default_list_root);

    // Strict ordering: low_neighbour < borrower_id_hash < high_neighbour.
    // `<` on Field compares the underlying integer representation.
    assert(low_neighbour < borrower_id_hash);
    assert(borrower_id_hash < high_neighbour);
    // TODO(default-list): also prove `high_neighbour`'s inclusion AND that it is
    //   the immediate successor of `low_neighbour` (adjacent indices / shared
    //   path prefix) using an indexed Merkle tree, so the prover cannot supply a
    //   non-adjacent high neighbour. Upgrades soundness from "trusts supplied
    //   successor" to full non-membership.
}

// ------------------------------------------------------------------------------
// Tests — run with `nargo test` (requires the Noir toolchain).
// Each test computes commitment/root the same way the circuit does, so values
// stay self-consistent regardless of the exact pedersen outputs.
// ------------------------------------------------------------------------------
#[test]
fn test_eligible_borrower_passes() {
    let monthly_income: u64 = 5000;
    let income_blinding: Field = 12345;
    let income_commitment = hash2(monthly_income as Field, income_blinding);

    let borrower_secret: Field = 777;
    let borrower_id_hash = hash1(borrower_secret);
    let nullifier = hash1(borrower_id_hash);

    // low_neighbour = 1 is < any pedersen output. high_neighbour is a value
    // assumed larger than the id hash for the strict gap check; if a given
    // build's id hash exceeds it, raise the constant.
    let low_neighbour: Field = 1;
    let high_neighbour: Field =
        0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000;
    let merkle_index_bits: [u1; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    let merkle_siblings: [Field; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    let default_list_root =
        compute_merkle_root(low_neighbour, merkle_index_bits, merkle_siblings);

    main(
        monthly_income,
        income_blinding,
        borrower_secret,
        low_neighbour,
        high_neighbour,
        merkle_index_bits,
        merkle_siblings,
        3000,
        default_list_root,
        income_commitment,
        nullifier,
    );
}

#[test(should_fail)]
fn test_income_below_threshold_fails() {
    let monthly_income: u64 = 1000; // below threshold
    let income_blinding: Field = 12345;
    let income_commitment = hash2(monthly_income as Field, income_blinding);

    let borrower_secret: Field = 777;
    let borrower_id_hash = hash1(borrower_secret);
    let nullifier = hash1(borrower_id_hash);

    let low_neighbour: Field = 1;
    let high_neighbour: Field =
        0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000;
    let merkle_index_bits: [u1; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    let merkle_siblings: [Field; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    let default_list_root =
        compute_merkle_root(low_neighbour, merkle_index_bits, merkle_siblings);

    main(
        monthly_income,
        income_blinding,
        borrower_secret,
        low_neighbour,
        high_neighbour,
        merkle_index_bits,
        merkle_siblings,
        3000, // threshold > income => assert fails
        default_list_root,
        income_commitment,
        nullifier,
    );
}
