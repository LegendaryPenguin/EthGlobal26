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
        uint32 onTimePayments; // loans fully repaid (credit history, bound to the human)
        uint32 latePayments; // times marked late
        uint32 defaults; // times defaulted / locked out
    }

    /// @notice A portable, person-bound credit report any lender can poll by wallet. Because it is
    ///         keyed by the World ID human (not the wallet), every wallet of the same human returns the
    ///         same report — reputation that travels across lenders (the ERC-8004 thesis).
    struct CreditReport {
        bytes32 passportId;
        Standing standing;
        uint256 limit; // USDC, 6 decimals
        uint32 score;
        uint32 onTimePayments;
        uint32 latePayments;
        uint32 defaults;
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

    /// @notice The human's credit score (bound to personhood, shared across their wallets).
    function scoreOf(address wallet) external view returns (uint32) {
        return passports[walletToHuman[wallet]].score;
    }

    /// @notice Poll a human's full, portable credit report by any of their wallets. Returns a zeroed
    ///         report (passportId == 0) if the wallet has no passport. Any lender can call this — the
    ///         reputation is bound to the person, not the wallet.
    function creditReport(address wallet) external view returns (CreditReport memory) {
        Passport storage p = passports[walletToHuman[wallet]];
        return CreditReport({
            passportId: p.id,
            standing: p.standing,
            limit: p.limit,
            score: p.score,
            onTimePayments: p.onTimePayments,
            latePayments: p.latePayments,
            defaults: p.defaults
        });
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

    // ─────────────────────────────────────────────────────────────────────────
    // Stage 8 — wallet-keyed reputation state machine (driven by LoanVault)
    // ─────────────────────────────────────────────────────────────────────────
    //
    // These wrap {setStanding}'s generic poke in the specific repayment-outcome transitions from
    // docs/02 ("Default handling (state, not narrative)"). They are keyed by WALLET (the loan layer
    // only knows borrower wallets) and resolve the one-human passport via {walletToHuman}. Each is a
    // safe no-op if the wallet has no passport, so the LoanVault can call them unconditionally
    // without having to know whether a borrower ever minted a passport.

    /// @dev Score penalty applied on a lateness transition (Good → Late). Small + temporary; heals on
    ///      full repayment. Saturating-subtracted so score never underflows.
    uint32 public constant LATE_SCORE_PENALTY = 10;
    /// @dev Score bump granted on a full, on-time repayment.
    uint32 public constant REPAYMENT_SCORE_BUMP = 20;

    /// @notice Good → Late with a small temporary score ding. No-op if the wallet has no passport, is
    ///         already Late, or has walked away (Defaulted/LockedOut — a worse state, don't soften it).
    ///         Limit is left untouched: a late borrower may still borrow (see {isInGoodStanding}).
    function recordLateness(address wallet) external onlyReputationAuthority {
        uint256 nullifierHash = walletToHuman[wallet];
        Passport storage p = passports[nullifierHash];
        if (p.id == bytes32(0)) return; // no passport → nothing to ding
        if (p.standing != Standing.Good) return; // only the Good → Late edge transitions
        p.standing = Standing.Late;
        p.latePayments += 1; // credit history: another late mark on this human
        p.score = p.score > LATE_SCORE_PENALTY ? p.score - LATE_SCORE_PENALTY : 0;
        emit StandingUpdated(nullifierHash, p.standing, p.score, p.limit);
    }

    /// @notice Walked away from a loan → LockedOut, score 0, limit 0. This is the network-wide lockout
    ///         that makes a respawning wallet's {verifyAndMint} revert {HumanLockedOut}. No-op if the
    ///         wallet has no passport. Idempotent if already LockedOut.
    function recordDefault(address wallet) external onlyReputationAuthority {
        uint256 nullifierHash = walletToHuman[wallet];
        Passport storage p = passports[nullifierHash];
        if (p.id == bytes32(0)) return; // no passport → nothing to lock
        if (p.standing != Standing.LockedOut) p.defaults += 1; // count the first lock-out only
        p.standing = Standing.LockedOut;
        p.score = 0;
        p.limit = 0;
        emit StandingUpdated(nullifierHash, p.standing, p.score, p.limit);
    }

    /// @notice Full repayment heals reputation: Late → Good, bumps the score, and ladders the limit UP.
    ///         No-op if the wallet has no passport. LADDER RULE (documented + chosen): the new limit is
    ///         `currentLimit + INITIAL_LIMIT / 2` (a flat +$250 step), so good borrowers climb steadily
    ///         from $500 → $750 → $1000 … We picked the flat additive step over a +50% multiplicative
    ///         one because it is bounded, easy to reason about in the demo, and avoids runaway growth on
    ///         already-large limits. A walked-away human (Defaulted/LockedOut) is NOT healed here — that
    ///         requires {cure}.
    function recordFullRepayment(address wallet) external onlyReputationAuthority {
        uint256 nullifierHash = walletToHuman[wallet];
        Passport storage p = passports[nullifierHash];
        if (p.id == bytes32(0)) return; // no passport → nothing to heal
        if (p.standing == Standing.LockedOut || p.standing == Standing.Defaulted) return; // needs cure, not heal
        p.standing = Standing.Good; // heals Late → Good (and keeps Good as Good)
        p.onTimePayments += 1; // credit history: another loan repaid in full
        p.score = p.score + REPAYMENT_SCORE_BUMP;
        p.limit = p.limit + (INITIAL_LIMIT / 2); // ladder up by a flat +$250 step
        emit StandingUpdated(nullifierHash, p.standing, p.score, p.limit);
    }

    /// @notice Authority-only "default-then-cure" path (docs/02): a LockedOut/Defaulted human who comes
    ///         back, repays + takes a penalty, is allowed to RE-ENTER the system at a low limit. Moves
    ///         them to Late (not Good — they re-enter on probation) at the supplied low `newLimit`, with
    ///         score reset to 0. Reverts {NoPassport} if the wallet has none. Intended for an operator /
    ///         off-chain reputation service after partial recovery, not an automatic on-chain edge.
    function cure(address wallet, uint256 newLimit) external onlyReputationAuthority {
        uint256 nullifierHash = walletToHuman[wallet];
        Passport storage p = passports[nullifierHash];
        if (p.id == bytes32(0)) revert NoPassport();
        p.standing = Standing.Late; // re-enter on probation, can borrow but flagged
        p.score = 0;
        p.limit = newLimit;
        emit StandingUpdated(nullifierHash, p.standing, p.score, newLimit);
    }
}
