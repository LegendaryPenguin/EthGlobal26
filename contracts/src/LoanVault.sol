// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILoanRegistry} from "./interfaces/ILoanRegistry.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @dev Minimal view the vault needs to gate disbursement on personhood + good standing (Stage 4).
interface IPassportGate {
    function isInGoodStanding(address wallet) external view returns (bool);
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

    uint256 public constant TERM_DAYS = 30;
    uint256 public constant INSTALLMENTS = 4;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant DAYS_PER_YEAR = 365;

    struct Loan {
        uint256 principal;          // disbursed amount, 6 decimals
        uint256 totalRepayable;     // principal + simple interest, 6 decimals
        uint256 outstanding;        // remaining owed, 6 decimals
        uint256 installmentAmount;  // scheduled repayment slice per payout, 6 decimals
        uint16  aprBps;
        uint64  startedAt;
        bool    disbursed;
        bool    repaid;
    }

    mapping(address borrower => Loan) public loans;

    event Funded(address indexed from, uint256 amount);
    event Disbursed(address indexed borrower, uint256 principal, uint256 totalRepayable, bytes32 attestationRef);
    event Repaid(address indexed borrower, uint256 amount, uint256 outstanding);
    event LoanFullyRepaid(address indexed borrower, uint256 totalRepaid);

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
            repaid: false
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
