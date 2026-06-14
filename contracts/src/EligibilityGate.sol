// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @notice Minimal surface of the bb-generated HonkVerifier (see HonkVerifier.sol).
interface IEligibilityVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title EligibilityGate — the on-chain ZK gate before underwriting (Track D, on-chain verify).
/// @notice Verifies the borrower's Noir/UltraHonk eligibility proof on Arc and records the verdict,
///         so the underwriting forwarder can require an on-chain pass before `LoanRegistry.setTerms`.
///
/// The proof attests (in zero knowledge): income >= threshold AND the borrower is not on the default
/// list — WITHOUT revealing income. The income figure is a private witness and is never an input here.
///
/// Two soundness properties this contract adds on top of raw `verifier.verify`:
///   1. POLICY RE-BIND — the proof's public `threshold` and `defaultListRoot` MUST equal the policy
///      this gate currently enforces. Without this, an old proof against a lower threshold / stale
///      default-list root could be replayed. Public-input order is load-bearing:
///        publicInputs = [threshold, defaultListRoot, incomeCommitment, nullifier]
///   2. NULLIFIER REPLAY GUARD — the circuit binds a one-human nullifier but does not track reuse;
///      we reject a second pass for the same nullifier so one human can't farm many approvals.
contract EligibilityGate {
    /// @dev Public-input slots (order matches circuits/src/main.nr `pub` params + the prover).
    uint256 private constant I_THRESHOLD = 0;
    uint256 private constant I_DEFAULT_LIST_ROOT = 1;
    uint256 private constant I_INCOME_COMMITMENT = 2;
    uint256 private constant I_NULLIFIER = 3;

    address public owner;
    IEligibilityVerifier public immutable verifier;

    /// @notice The policy the gate enforces; proofs must re-bind to exactly these.
    bytes32 public threshold; // affordability bar (e.g. 3000), as bytes32
    bytes32 public defaultListRoot; // Merkle root of the sorted defaulter registry

    /// @notice One pass per human nullifier.
    mapping(bytes32 nullifier => bool) public nullifierUsed;
    /// @notice Last block at which a borrower passed the gate (0 = never). Read by the forwarder.
    mapping(address borrower => uint256) public eligibleAtBlock;

    error NotOwner();
    error StaleThreshold();
    error StaleDefaultListRoot();
    error BadPublicInputs();
    error NullifierAlreadyUsed();
    error ProofInvalid();

    event PolicyUpdated(bytes32 threshold, bytes32 defaultListRoot);
    event EligibilityProven(address indexed borrower, bytes32 indexed nullifier, bytes32 incomeCommitment);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _verifier, bytes32 _threshold, bytes32 _defaultListRoot) {
        owner = msg.sender;
        verifier = IEligibilityVerifier(_verifier);
        threshold = _threshold;
        defaultListRoot = _defaultListRoot;
        emit PolicyUpdated(_threshold, _defaultListRoot);
    }

    /// @notice Rotate the enforced policy (e.g. raise the bar, publish a new default-list root).
    function setPolicy(bytes32 _threshold, bytes32 _defaultListRoot) external onlyOwner {
        threshold = _threshold;
        defaultListRoot = _defaultListRoot;
        emit PolicyUpdated(_threshold, _defaultListRoot);
    }

    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
    }

    /// @notice True if `borrower` has a recorded on-chain eligibility pass.
    function isEligible(address borrower) external view returns (bool) {
        return eligibleAtBlock[borrower] != 0;
    }

    /// @notice Verify an eligibility proof and record the pass for `borrower`.
    /// @dev Reverts unless the proof verifies AND re-binds to the current policy AND the nullifier
    ///      is unused. `borrower` is the address the recorded pass is attributed to (the managed
    ///      wallet / borrower). Public inputs are NOT trusted from the caller beyond what the
    ///      verifier proves — we additionally pin threshold + root to this gate's policy.
    function proveEligibility(address borrower, bytes calldata proof, bytes32[] calldata publicInputs)
        external
        returns (bytes32 nullifier)
    {
        if (publicInputs.length != 4) revert BadPublicInputs();
        if (publicInputs[I_THRESHOLD] != threshold) revert StaleThreshold();
        if (publicInputs[I_DEFAULT_LIST_ROOT] != defaultListRoot) revert StaleDefaultListRoot();

        nullifier = publicInputs[I_NULLIFIER];
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed();

        if (!verifier.verify(proof, publicInputs)) revert ProofInvalid();

        nullifierUsed[nullifier] = true;
        eligibleAtBlock[borrower] = block.number;
        emit EligibilityProven(borrower, nullifier, publicInputs[I_INCOME_COMMITMENT]);
    }
}
