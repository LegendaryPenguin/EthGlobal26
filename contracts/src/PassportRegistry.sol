// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PassportRegistry (ERC-8004) — identity-bound credit reputation. STUB for Stage 4.
/// @notice Mints ONE passport per verified human (keyed by the World ID nullifier hash), stores
///         reputation/standing, and exposes the borrower's limit. Updated by repayment outcomes.
///         This is the anti-respawn spine — a second wallet from the same human maps to the same
///         passport (and the same standing/flag). See docs/05 (World ID) + docs/02 (defaults).
/// @dev    STAGE 4: validate the World ID proof ON-CHAIN via the World ID verifier (the track
///         forbids client-only validation). Pull the verifier address from World docs / env.
contract PassportRegistry {
    enum Standing { None, Good, Late, Defaulted, LockedOut }

    struct Passport {
        bytes32 id;           // identity-bound id (one per human)
        Standing standing;
        uint256 limit;        // current credit limit, USDC 6 decimals
        uint32  score;
    }

    /// @dev nullifierHash (World ID) → passport. The one-human key.
    mapping(uint256 nullifierHash => Passport) public passports;
    /// @dev wallet → nullifierHash, so a re-used human resolves to the same passport.
    mapping(address wallet => uint256 nullifierHash) public walletToHuman;

    event PassportMinted(uint256 indexed nullifierHash, address indexed wallet, bytes32 id);
    event StandingUpdated(uint256 indexed nullifierHash, Standing standing, uint32 score, uint256 limit);

    /// @notice Verify a World ID proof on-chain and mint/lookup the caller's passport.
    /// @dev    STAGE 4 TODO:
    ///         - call the World ID verifier with (signal, root, nullifierHash, proof)
    ///         - reject if this human is LockedOut (respawn-rejection demo, money-shot #2)
    ///         - scope the action id to "mint-credit-passport"
    function verifyAndMint(
        address, /* signal */
        uint256, /* root */
        uint256 nullifierHash,
        uint256[8] calldata /* proof */
    ) external {
        // placeholder — real World ID verification lands in Stage 4
        if (passports[nullifierHash].id == bytes32(0)) {
            passports[nullifierHash] =
                Passport({id: bytes32(nullifierHash), standing: Standing.Good, limit: 0, score: 0});
            emit PassportMinted(nullifierHash, msg.sender, bytes32(nullifierHash));
        }
        walletToHuman[msg.sender] = nullifierHash;
    }
}
