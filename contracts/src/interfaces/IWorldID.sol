// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The World ID router/verifier. Reverts if the zero-knowledge proof is invalid.
///         The real address is pulled from World docs / env (WORLD_ID_VERIFIER_ADDRESS) — never
///         hardcoded. The track requires the proof be validated ON-CHAIN (not client-only).
interface IWorldID {
    /// @param root              The Merkle root of the World ID identity group.
    /// @param groupId           1 for the Orb-verified group.
    /// @param signalHash        hashToField of the signal (we bind the borrower's address).
    /// @param nullifierHash     The one-human key, scoped to our action.
    /// @param externalNullifierHash hashToField(appId, actionId) — scopes the nullifier to our app.
    /// @param proof             The 8-field Groth16 proof from IDKit.
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}
