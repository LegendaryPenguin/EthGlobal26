// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";

/// @dev Minimal view into the LoanVault the router needs (sized slice + apply repayment).
interface ILoanVault {
    function scheduledSlice(address borrower) external view returns (uint256);
    function repay(address borrower, uint256 amount) external returns (uint256 applied);
    function isRepaid(address borrower) external view returns (bool);
}

/// @title IncomeRouter (Arc) — auto-repayment from future income.
/// @notice Intercepts an incoming creator payout, deducts the scheduled repayment slice
///         (→ LoanVault), forwards the remainder to the borrower. Multi-step settlement.
/// @dev    The frontend "cash out" button (docs/06 Stage 7) calls `onPayout` for real.
///         USDC = 6 decimals (Golden Rule #4).
///
///         APPROVAL REQUIREMENT (documented):
///         The router pulls the *full* payout via `usdc.transferFrom(payer, ...)`. The payer
///         (the payout source — e.g. the creator platform's settlement wallet) MUST have approved
///         this router for at least `amount` USDC before calling {onPayout}. The router never holds
///         a standing balance: it pulls, splits, and forwards atomically within the call.
contract IncomeRouter {
    ILoanVault public immutable vault;
    IERC20 public immutable usdc;

    event PayoutSplit(address indexed borrower, uint256 total, uint256 toRepayment, uint256 toBorrower);
    event BorrowerFullyRepaid(address indexed borrower);

    error ZeroAmount();
    error TransferFailed();

    /// @param _vault The LoanVault that holds the schedule and receives repayments.
    /// @param _usdc  Injected USDC address (6 decimals) — never hardcoded (Golden Rule #5).
    constructor(address _vault, address _usdc) {
        vault = ILoanVault(_vault);
        usdc = IERC20(_usdc);
    }

    /// @notice Split an incoming payout: scheduled repayment slice → vault, remainder → borrower.
    /// @param borrower The loan holder whose schedule sizes the slice (also receives the remainder).
    /// @param amount   The full payout in USDC (6 decimals).
    /// @dev    Pulls `amount` from `msg.sender` (the payer) via transferFrom — msg.sender must have
    ///         approved this router. Invariant: toRepayment + toBorrower == amount.
    ///         LATER-STAGE TODO: on full repay, PassportRegistry can consume {BorrowerFullyRepaid}
    ///         / the vault's `LoanFullyRepaid` to bump score / ladder the limit. The router only
    ///         emits state here — it does NOT call PassportRegistry.
    function onPayout(address borrower, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        // Pull the full payout from the payer into the router.
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        // Size the repayment slice from the borrower's schedule, capped at the payout.
        uint256 slice = vault.scheduledSlice(borrower);
        if (slice > amount) slice = amount;

        uint256 remainder = amount - slice;

        if (slice > 0) {
            // Move the slice into the vault, then apply it against the outstanding balance.
            if (!usdc.transfer(address(vault), slice)) revert TransferFailed();
            vault.repay(borrower, slice);
        }

        if (remainder > 0) {
            if (!usdc.transfer(borrower, remainder)) revert TransferFailed();
        }

        emit PayoutSplit(borrower, amount, slice, remainder);

        if (vault.isRepaid(borrower)) {
            emit BorrowerFullyRepaid(borrower);
        }
    }
}
