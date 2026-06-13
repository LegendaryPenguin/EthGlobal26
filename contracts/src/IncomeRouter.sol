// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IncomeRouter (Arc) — auto-repayment from future income. STUB for Stage 2.
/// @notice Intercepts an incoming creator payout, deducts the scheduled repayment slice
///         (→ LoanVault), forwards the remainder to the borrower. Multi-step settlement.
/// @dev    The frontend "cash out" button (docs/06 Stage 7) calls `onPayout` for real — that is
///         demo money-shot #3. USDC = 6 decimals (Golden Rule #4).
contract IncomeRouter {
    address public immutable vault;

    event PayoutSplit(address indexed borrower, uint256 total, uint256 toRepayment, uint256 toBorrower);

    constructor(address _vault) {
        vault = _vault;
    }

    /// @notice Split an incoming payout: repayment slice → vault, remainder → borrower.
    /// @dev    STAGE 2 TODO:
    ///         - read the borrower's amortization schedule from LoanVault to size the slice
    ///         - pull USDC via transferFrom (router must be approved) and route both legs
    ///         - on full repay, call PassportRegistry to bump score / ladder the limit
    function onPayout(address borrower, uint256 amount) external {
        // placeholder split logic — real schedule comes from the vault in Stage 2
        emit PayoutSplit(borrower, amount, 0, amount);
    }
}
