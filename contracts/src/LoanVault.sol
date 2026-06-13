// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILoanRegistry} from "./interfaces/ILoanRegistry.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @dev Minimal view the vault needs to gate disbursement on personhood + good standing (Stage 4).
interface IPassportGate {
    function isInGoodStanding(address wallet) external view returns (bool);
}

/// @dev Stage 8 reputation hooks the vault drives from repayment outcomes. These are the specific
///      wallet-keyed transitions on the PassportRegistry; each is a no-op there if the wallet has no
///      passport, so the vault may call them unconditionally whenever `passportRegistry` is wired.
interface IPassportReputation {
    function recordLateness(address wallet) external;
    function recordDefault(address wallet) external;
    function recordFullRepayment(address wallet) external;
}

/// @dev Stage 8 loss hook on the TranchePool. The vault reports a default's unrecovered principal so
///      the junior tranche absorbs it first (waterfall). Optional (gated on `tranchePool` != 0).
interface ITranchePoolLoss {
    function absorbLoss(uint256 amount) external returns (uint256 fromJunior, uint256 fromSenior);
}

/// @title LoanVault (Arc) — the money layer.
/// @notice Holds pooled USDC; on a borrower's claim, checks `getTerms` + a valid attestation,
///         then disburses. Tracks per-loan balance + a fixed-term, equal-installment amortization
///         schedule. Repayment is driven by the {IncomeRouter} via {repay}. See docs/02 + docs/06.
/// @dev    USDC is 6 decimals (Golden Rule #4). USDC address must be injected, never hardcoded
///         (Golden Rule #5) — pass it from a deploy script that reads the Circle MCP/address page.
///
///         AMORTIZATION MODEL (documented):
///         - Term: fixed 30 days, split into 4 equal installments (one ~ every 7.5 days).
///         - Interest: SIMPLE interest over the term, not compounding:
///               interest = principal * aprBps * TERM_DAYS / (BPS_DENOMINATOR * 365)
///           e.g. $500 @ 1000 bps (10% APR) over 30 days = 500e6 * 1000 * 30 / (10000 * 365)
///                = ~4.109589e6 ≈ $4.11. Total repayable = principal + interest.
///         - `installmentAmount` = ceil(totalRepayable / INSTALLMENTS); the IncomeRouter sizes each
///           payout's repayment slice to this (capped at the remaining `outstanding`).
///         - `outstanding` starts at totalRepayable and is reduced by {repay}. When it hits 0 the
///           loan is flagged `repaid` and a {Repaid} event fires (consumable later by PassportRegistry).
contract LoanVault {
    ILoanRegistry public immutable registry;
    IERC20 public immutable usdc;
    address public router;
    address public owner;

    /// @dev Optional World ID passport gate (Stage 4). When set, claim() requires the borrower's
    ///      human to be in good standing — the anti-respawn check. address(0) disables it (e.g. for
    ///      early money-layer tests); production deploys MUST set it.
    address public passportRegistry;

    /// @dev Optional Stage 8 tranche pool (loss layer). When set, a {markDefault} reports the loan's
    ///      unrecovered principal to the pool's loss waterfall (junior-first). address(0) = skip loss
    ///      reporting, so a vault deployed without the lender side still works (existing tests do this).
    address public tranchePool;

    uint256 public constant TERM_DAYS = 30;
    uint256 public constant INSTALLMENTS = 4;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant DAYS_PER_YEAR = 365;

    /// @dev Slack after a missed installment (markLate) and after the term ends (markDefault) before
    ///      the respective state can be forced. A borrower is never marked late/defaulted the instant
    ///      a deadline passes; they get this grace window first.
    uint256 public constant GRACE_PERIOD = 3 days;

    struct Loan {
        uint256 principal;          // disbursed amount, 6 decimals
        uint256 totalRepayable;     // principal + simple interest, 6 decimals
        uint256 outstanding;        // remaining owed, 6 decimals
        uint256 installmentAmount;  // scheduled repayment slice per payout, 6 decimals
        uint16  aprBps;
        uint64  startedAt;
        bool    disbursed;
        bool    repaid;
        bool    defaulted;         // Stage 8: term + grace elapsed while still owing → written off
    }

    mapping(address borrower => Loan) public loans;

    event Funded(address indexed from, uint256 amount);
    event Disbursed(address indexed borrower, uint256 principal, uint256 totalRepayable, bytes32 attestationRef);
    event Repaid(address indexed borrower, uint256 amount, uint256 outstanding);
    event LoanFullyRepaid(address indexed borrower, uint256 totalRepaid);
    event MarkedLate(address indexed borrower, uint256 repaidSoFar, uint256 expectedRepaid);
    event Defaulted(address indexed borrower, uint256 outstanding, uint256 capitalLoss);

    error NotApproved();
    error TermsExpired();
    error AlreadyDisbursed();
    error MissingAttestation();
    error ZeroPrincipal();
    error VaultUnderfunded();
    error TransferFailed();
    error NotRouter();
    error NotOwner();
    error NoActiveLoan();
    error AlreadyRepaid();
    error ZeroAmount();
    error ZeroRouter();
    error NotInGoodStanding();
    error NotBehindSchedule();
    error AlreadyLate();
    error AlreadyDefaulted();
    error TermNotElapsed();
    error TermEnded();
    error GraceNotElapsed();

    event RouterUpdated(address indexed previousRouter, address indexed newRouter);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param _registry The frozen LoanRegistry seam.
    /// @param _usdc      Injected USDC address (6 decimals).
    /// @param _router    The IncomeRouter authorized to push repayments. May be address(0) at deploy
    ///                   and set later via {setRouter} (the router needs the vault address first).
    constructor(address _registry, address _usdc, address _router) {
        registry = ILoanRegistry(_registry);
        usdc = IERC20(_usdc);
        router = _router;
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Funding
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Seed the vault with USDC. Caller must have approved this vault for `amount`.
    /// @dev    Anyone may fund (lenders, owner, tests). The vault's USDC balance is the lending pool.
    function fund(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Disbursement
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Borrower claims an approved loan. Reads the seam, validates, builds the amortization
    ///         schedule, then safe-transfers the principal in USDC.
    /// @dev    STAGE-LATER TODO:
    ///         - verify `attestationRef` against the Chainlink attestation (Confidential AI track).
    ///           For now it is only checked non-zero.
    ///         - integrate the World ID / passport good-standing check before disbursing.
    function claim() external {
        ILoanRegistry.Terms memory t = registry.getTerms(msg.sender);

        if (!t.approved) revert NotApproved();
        if (t.expiry != 0 && block.timestamp > t.expiry) revert TermsExpired();
        if (t.attestationRef == bytes32(0)) revert MissingAttestation();
        if (t.principal == 0) revert ZeroPrincipal();
        if (loans[msg.sender].disbursed) revert AlreadyDisbursed();

        // Stage 4 anti-respawn gate: a verified human in good standing. Skipped only when unset.
        if (passportRegistry != address(0) && !IPassportGate(passportRegistry).isInGoodStanding(msg.sender)) {
            revert NotInGoodStanding();
        }

        uint256 totalRepayable = _totalRepayable(t.principal, t.aprBps);
        uint256 installment = _ceilDiv(totalRepayable, INSTALLMENTS);

        // Underfunded check before any state change / transfer.
        if (usdc.balanceOf(address(this)) < t.principal) revert VaultUnderfunded();

        loans[msg.sender] = Loan({
            principal: t.principal,
            totalRepayable: totalRepayable,
            outstanding: totalRepayable,
            installmentAmount: installment,
            aprBps: t.aprBps,
            startedAt: uint64(block.timestamp),
            disbursed: true,
            repaid: false,
            defaulted: false
        });

        emit Disbursed(msg.sender, t.principal, totalRepayable, t.attestationRef);

        _safeTransfer(msg.sender, t.principal);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Repayment (driven by the IncomeRouter)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Apply a repayment to a borrower's outstanding balance. The USDC for `amount` must
    ///         already have been transferred into this vault by the caller (the router pulls it from
    ///         the payout and forwards the slice here, then calls {repay}).
    /// @dev    Router-only. Returns the amount actually applied (capped at `outstanding`).
    function repay(address borrower, uint256 amount) external returns (uint256 applied) {
        if (msg.sender != router) revert NotRouter();
        if (amount == 0) revert ZeroAmount();

        Loan storage loan = loans[borrower];
        if (!loan.disbursed) revert NoActiveLoan();
        if (loan.repaid) revert AlreadyRepaid();

        applied = amount > loan.outstanding ? loan.outstanding : amount;
        loan.outstanding -= applied;

        emit Repaid(borrower, applied, loan.outstanding);

        if (loan.outstanding == 0) {
            loan.repaid = true;
            emit LoanFullyRepaid(borrower, loan.totalRepayable);
            // Reputation heals + ladders up on full repayment. Optional (skipped if unset); the
            // registry no-ops if this borrower never minted a passport.
            if (passportRegistry != address(0)) {
                IPassportReputation(passportRegistry).recordFullRepayment(borrower);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views used by the IncomeRouter
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The scheduled repayment slice for the next payout: min(installment, outstanding).
    ///         Returns 0 if there is no active/unrepaid loan.
    function scheduledSlice(address borrower) public view returns (uint256) {
        Loan storage loan = loans[borrower];
        if (!loan.disbursed || loan.repaid || loan.outstanding == 0) return 0;
        uint256 slice = loan.installmentAmount;
        return slice > loan.outstanding ? loan.outstanding : slice;
    }

    function outstandingOf(address borrower) external view returns (uint256) {
        return loans[borrower].outstanding;
    }

    function isRepaid(address borrower) external view returns (bool) {
        return loans[borrower].repaid;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stage 8 — overdue / default tracking (permissionless, grace-gated)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The amount the schedule says SHOULD have been repaid by now: one `installmentAmount`
    ///         per elapsed `installmentInterval` (TERM_DAYS / INSTALLMENTS = 7.5 days), capped at
    ///         `totalRepayable`. Returns 0 if there is no active (disbursed, unrepaid, undefaulted) loan.
    /// @dev    e.g. at +8 days, one full installment is due; at +16 days, two; at term end, all four.
    function expectedRepaid(address borrower) public view returns (uint256) {
        Loan storage loan = loans[borrower];
        if (!loan.disbursed || loan.repaid || loan.defaulted) return 0;
        uint256 elapsed = block.timestamp - loan.startedAt;
        uint256 installmentInterval = (TERM_DAYS * 1 days) / INSTALLMENTS;
        uint256 due = (elapsed / installmentInterval) * loan.installmentAmount;
        return due > loan.totalRepayable ? loan.totalRepayable : due;
    }

    /// @notice How much of `totalRepayable` has actually been repaid so far.
    function repaidSoFar(address borrower) public view returns (uint256) {
        Loan storage loan = loans[borrower];
        return loan.totalRepayable - loan.outstanding;
    }

    /// @notice PERMISSIONLESS: flag a behind-schedule borrower as Late on their passport. Anyone may
    ///         call this — lateness is an objective, on-chain fact (the schedule says X is due, only
    ///         Y < X has been paid, and the grace window after the missed installment has elapsed).
    /// @dev    Requirements: an active loan (disbursed, !repaid, !defaulted), still inside the term,
    ///         actually behind schedule, and at least GRACE_PERIOD past the most-recent due installment.
    ///         Only transitions a borrower currently in Good standing (the registry no-ops otherwise,
    ///         e.g. already Late / no passport). Skips entirely if `passportRegistry` is unset.
    function markLate(address borrower) external {
        Loan storage loan = loans[borrower];
        if (!loan.disbursed) revert NoActiveLoan();
        if (loan.repaid) revert AlreadyRepaid();
        if (loan.defaulted) revert AlreadyDefaulted();

        uint256 termEnd = loan.startedAt + TERM_DAYS * 1 days;
        // After the term ends, default (not late) is the right state. Lateness is an in-term signal.
        if (block.timestamp >= termEnd) revert TermEnded();

        uint256 owedNow = expectedRepaid(borrower);
        uint256 paid = repaidSoFar(borrower);
        if (paid >= owedNow) revert NotBehindSchedule();

        // Grace: require GRACE_PERIOD to have elapsed since the most recent installment came due, so a
        // borrower is never marked late the instant an installment deadline passes.
        uint256 installmentInterval = (TERM_DAYS * 1 days) / INSTALLMENTS;
        uint256 installmentsDue = owedNow / loan.installmentAmount; // # of installments currently due
        uint256 lastDueAt = loan.startedAt + installmentsDue * installmentInterval;
        if (block.timestamp < lastDueAt + GRACE_PERIOD) revert GraceNotElapsed();

        emit MarkedLate(borrower, paid, owedNow);

        // Drive the reputation transition. Only Good → Late actually moves (registry no-ops on Late /
        // no-passport), so a repeat call is a clean no-op rather than a revert.
        if (passportRegistry != address(0)) {
            IPassportReputation(passportRegistry).recordLateness(borrower);
        }
    }

    /// @notice PERMISSIONLESS: write off a loan that ran past its full term + grace while still owing.
    ///         Anyone may call this. Sets `defaulted`, reports the unrecovered principal to the tranche
    ///         pool's loss waterfall (if wired), and locks the human out network-wide (if wired).
    /// @dev    LOSS FORMULA (documented): the pool's loss is unrecovered *principal* only —
    ///             capitalLoss = principal > repaidSoFar ? principal - repaidSoFar : 0.
    ///         Interest is recognized only as it is actually paid (it flows through the IncomeRouter and
    ///         is distributed as yield), so unearned interest is NOT a balance-sheet loss to the pool;
    ///         only lent capital that never came back is. Repayments are applied to `outstanding`
    ///         (principal + interest) as one pot, so `repaidSoFar` first offsets what would otherwise be
    ///         principal loss — i.e. partial repayments shrink the capital loss.
    function markDefault(address borrower) external {
        Loan storage loan = loans[borrower];
        if (!loan.disbursed) revert NoActiveLoan();
        if (loan.repaid) revert AlreadyRepaid();
        if (loan.defaulted) revert AlreadyDefaulted();

        uint256 defaultAt = loan.startedAt + TERM_DAYS * 1 days + GRACE_PERIOD;
        if (block.timestamp < defaultAt) revert TermNotElapsed();

        loan.defaulted = true;

        uint256 paid = repaidSoFar(borrower);
        uint256 capitalLoss = loan.principal > paid ? loan.principal - paid : 0;

        emit Defaulted(borrower, loan.outstanding, capitalLoss);

        // Report the capital loss to the tranche waterfall (junior-first). Optional.
        if (tranchePool != address(0) && capitalLoss > 0) {
            ITranchePoolLoss(tranchePool).absorbLoss(capitalLoss);
        }

        // Lock the human out network-wide — the anti-respawn flag. Optional; registry no-ops if the
        // borrower never minted a passport.
        if (passportRegistry != address(0)) {
            IPassportReputation(passportRegistry).recordDefault(borrower);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
    }

    /// @notice Set/rotate the IncomeRouter authorized to push repayments. Owner-only.
    /// @dev    Needed because the vault and router reference each other — deploy order is
    ///         vault → router → `setRouter(router)`.
    function setRouter(address _router) external onlyOwner {
        if (_router == address(0)) revert ZeroRouter();
        emit RouterUpdated(router, _router);
        router = _router;
    }

    /// @notice Set/rotate the World ID passport gate (Stage 4). Owner-only. address(0) disables it.
    function setPassportRegistry(address _passportRegistry) external onlyOwner {
        passportRegistry = _passportRegistry;
    }

    /// @notice Set/rotate the Stage 8 tranche pool that absorbs default losses. Owner-only.
    ///         address(0) disables loss reporting (the vault still functions; defaults just don't write
    ///         down a pool). The pool must also authorize this vault via its `setLossReporter`.
    function setTranchePool(address _tranchePool) external onlyOwner {
        tranchePool = _tranchePool;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal math + safe transfers
    // ─────────────────────────────────────────────────────────────────────────

    function _totalRepayable(uint256 principal, uint16 aprBps) internal pure returns (uint256) {
        // Simple interest over the fixed term. All 6-decimal USDC math.
        uint256 interest = (principal * aprBps * TERM_DAYS) / (BPS_DENOMINATOR * DAYS_PER_YEAR);
        return principal + interest;
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a + b - 1) / b;
    }

    function _safeTransfer(address to, uint256 amount) internal {
        if (usdc.balanceOf(address(this)) < amount) revert VaultUnderfunded();
        if (!usdc.transfer(to, amount)) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        if (!usdc.transferFrom(from, to, amount)) revert TransferFailed();
    }
}
