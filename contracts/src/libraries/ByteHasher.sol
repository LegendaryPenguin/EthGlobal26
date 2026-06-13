// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Standard World ID helper: hash bytes into the BN254 field (drop the top 8 bits so the
///         result fits the scalar field the World ID circuit operates over).
library ByteHasher {
    function hashToField(bytes memory value) internal pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }
}
