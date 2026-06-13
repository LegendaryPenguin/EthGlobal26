// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TranchePool (Arc) — senior/junior lender accounting + yield waterfall. STUB for Stage 8.
/// @notice Lenders deposit USDC and pick a tranche. Senior (~80%): fixed ~6% APY, first-loss
///         protected. Junior (~20%): absorbs defaults first, takes residual interest (~26% in the
///         worked example). See docs/01 for the math, docs/06 Stage 8.
/// @dev    Cross-chain deposits (any chain → Arc) arrive via Circle Gateway / CCTP V2 in Stage 6
///         (Golden Rule #6 — CCTP V2). USDC = 6 decimals.
contract TranchePool {
    enum Tranche { Senior, Junior }

    mapping(address lender => mapping(Tranche => uint256)) public deposits;
    uint256 public seniorTotal;
    uint256 public juniorTotal;

    event Deposited(address indexed lender, Tranche tranche, uint256 amount);
    event Withdrawn(address indexed lender, Tranche tranche, uint256 amount);

    /// @dev STAGE 8 TODO: pull USDC, accrue yield per the waterfall, route withdrawals back to the
    ///      lender's home chain via Gateway/CCTP.
    function deposit(Tranche tranche, uint256 amount) external {
        deposits[msg.sender][tranche] += amount;
        if (tranche == Tranche.Senior) seniorTotal += amount;
        else juniorTotal += amount;
        emit Deposited(msg.sender, tranche, amount);
    }
}
