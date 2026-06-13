// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWorldID} from "../src/interfaces/IWorldID.sol";

/// @notice Test double for the World ID verifier. Defaults to accepting proofs; flip `shouldRevert`
///         to simulate an invalid proof. The real verifier runs the Groth16 ZK check.
contract MockWorldID is IWorldID {
    bool public shouldRevert;

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function verifyProof(uint256, uint256, uint256, uint256, uint256, uint256[8] calldata) external view {
        require(!shouldRevert, "MockWorldID: invalid proof");
    }
}
