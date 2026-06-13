// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWorldID} from "./interfaces/IWorldID.sol";
import {ByteHasher} from "./libraries/ByteHasher.sol";

/// @title PassportRegistry (ERC-8004-style) — identity-bound credit reputation.
/// @notice Mints ONE passport per verified human, keyed by the World ID **nullifier hash**, and
///         tracks standing/limit. This is the anti-respawn spine: a second wallet from the same
///         human resolves to the SAME passport (and the same standing/flag), so a defaulter cannot
///         escape by spinning up a new wallet. See docs/05 (World ID) + docs/02 (default states).
/// @dev    The World ID proof is validated ON-CHAIN via the injected verifier (the track forbids
///         client-only validation). nullifier reuse is intentionally NOT rejected — re-verifying
///         binds a new wallet to the existing passport. We DO reject if the human is locked out.
contract PassportRegistry {
    using ByteHasher for bytes;

    enum Standing {
        None, // 0 — no passport
        Good, // 1 — in good standing
        Late, // 2 — minor ding, still allowed to borrow (heals on repayment)
        Defaulted, // 3 — defaulted; must cure
        LockedOut // 4 — walked away; locked out network-wide until cured
    }

    struct Passport {
        bytes32 id; // identity-bound id (one per human)
        Standing standing;
        uint256 limit; // current credit limit, USDC 6 decimals
        uint32 score;
    }

    /// @dev Default starting limit for a freshly verified human (USDC, 6 decimals). Ladders up
    ///      as loans are repaid (Stage 8).
    uint256 public constant INITIAL_LIMIT = 500_000_000; // $500
    uint256 internal constant GROUP_ID = 1; // Orb-verified group

    IWorldID public immutable worldId;
    uint256 public immutable externalNullifier; // hashToField(appId, actionId)
    address public owner;

    /// @dev The address allowed to update standing from repayment outcomes (LoanVault/IncomeRouter
    ///      or an off-chain reputation service). Owner can rotate it. Owner can also update directly.
    address public reputationOracle;

    /// @dev nullifierHash (World ID) → passport. The one-human key.
    mapping(uint256 nullifierHash => Passport) public passports;
    /// @dev wallet → nullifierHash, so a re-used human resolves to the same passport.
    mapping(address wallet => uint256 nullifierHash) public walletToHuman;

    event PassportMinted(uint256 indexed nullifierHash, address indexed wallet, bytes32 id, uint256 limit);
    event WalletBound(uint256 indexed nullifierHash, address indexed wallet);
    event StandingUpdated(uint256 indexed nullifierHash, Standing standing, uint32 score, uint256 limit);

    error NotOwner();
    error NotAuthorized();
    error HumanLockedOut();
    error NoPassport();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param _worldId   The World ID verifier (env WORLD_ID_VERIFIER_ADDRESS — never hardcoded).
    /// @param _appId     The World app id (e.g. "app_...").
    /// @param _actionId  The scoped action, e.g. "mint-credit-passport".
    constructor(IWorldID _worldId, string memory _appId, string memory _actionId) {
        worldId = _worldId;
        // externalNullifier = hashToField(hashToField(appId), actionId) — scopes the nullifier to us.
        externalNullifier = abi.encodePacked(abi.encodePacked(_appId).hashToField(), _actionId).hashToField();
        owner = msg.sender;
        reputationOracle = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Verification + minting
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Validate a World ID proof on-chain and mint (or look up) the human's passport,
    ///         binding `signal` (the borrower's wallet) to that human.
    /// @dev    Reverts via the verifier if the proof is invalid. Reverts {HumanLockedOut} if this
    ///         human previously walked away — that is the live respawn-rejection (money-shot #2).
    function verifyAndMint(address signal, uint256 root, uint256 nullifierHash, uint256[8] calldata proof)
        external
    {
        // 1. On-chain proof verification (reverts if invalid).
        worldId.verifyProof(
            root, GROUP_ID, abi.encodePacked(signal).hashToField(), nullifierHash, externalNullifier, proof
        );

        Passport storage p = passports[nullifierHash];

        if (p.id == bytes32(0)) {
            // First time this human is seen → mint a passport.
            p.id = bytes32(nullifierHash);
            p.standing = Standing.Good;
            p.limit = INITIAL_LIMIT;
            p.score = 0;
            emit PassportMinted(nullifierHash, signal, p.id, INITIAL_LIMIT);
        } else if (p.standing == Standing.LockedOut) {
            // Same human, new wallet, but they walked away from a prior loan → reject.
            revert HumanLockedOut();
        }

        walletToHuman[signal] = nullifierHash;
        emit WalletBound(nullifierHash, signal);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reads (used by LoanVault's good-standing gate)
    // ─────────────────────────────────────────────────────────────────────────

    function standingOf(address wallet) public view returns (Standing) {
        return passports[walletToHuman[wallet]].standing;
    }

    /// @notice A wallet may borrow if its human has a passport and is Good or Late (a late ding
    ///         does not lock you out). Defaulted / LockedOut / None cannot borrow.
    function isInGoodStanding(address wallet) external view returns (bool) {
        Standing s = standingOf(wallet);
        return s == Standing.Good || s == Standing.Late;
    }

    function limitOf(address wallet) external view returns (uint256) {
        return passports[walletToHuman[wallet]].limit;
    }

    function passportIdOf(address wallet) external view returns (bytes32) {
        return passports[walletToHuman[wallet]].id;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reputation updates (repayment outcomes / default-state transitions)
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyReputationAuthority() {
        if (msg.sender != owner && msg.sender != reputationOracle) revert NotAuthorized();
        _;
    }

    function setReputationOracle(address _oracle) external onlyOwner {
        reputationOracle = _oracle;
    }

    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
    }

    /// @notice Transition a human's standing (late ding, default, lock-out, or cure) and adjust
    ///         their score/limit. Callable by the owner or the reputation oracle.
    /// @dev    Stage 8 wires the LoanVault/IncomeRouter repayment outcomes into these calls.
    function setStanding(uint256 nullifierHash, Standing standing, uint32 score, uint256 limit)
        external
        onlyReputationAuthority
    {
        Passport storage p = passports[nullifierHash];
        if (p.id == bytes32(0)) revert NoPassport();
        p.standing = standing;
        p.score = score;
        p.limit = limit;
        emit StandingUpdated(nullifierHash, standing, score, limit);
    }
}
