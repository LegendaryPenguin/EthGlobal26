// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";
import {ILoanRegistry} from "../src/interfaces/ILoanRegistry.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {IncomeRouter} from "../src/IncomeRouter.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Stage 2 — Arc money layer. Disbursement + amortization + auto-repayment split.
contract LoanVaultTest is Test {
    LoanRegistry registry;
    LoanVault vault;
    IncomeRouter router;
    MockERC20 usdc;

    address forwarder = makeAddr("forwarder");
    address borrower = makeAddr("borrower");
    address payer = makeAddr("payer"); // the payout source (creator platform settlement wallet)
    address lender = makeAddr("lender");

    uint256 constant PRINCIPAL = 500_000_000; // $500 USDC (6 decimals)
    uint16 constant APR_BPS = 1000; // 10.00%

    // Expected schedule: simple interest over 30 days.
    // interest = 500e6 * 1000 * 30 / (10000 * 365) = 4_109_589 ($4.109589)
    uint256 constant EXPECTED_INTEREST = (PRINCIPAL * APR_BPS * 30) / (10_000 * 365);
    uint256 constant EXPECTED_TOTAL = PRINCIPAL + EXPECTED_INTEREST;
    // installment = ceil(total / 4)
    uint256 constant EXPECTED_INSTALLMENT = (EXPECTED_TOTAL + 3) / 4;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        registry = new LoanRegistry(forwarder);
        vault = new LoanVault(address(registry), address(usdc), address(0));
        router = new IncomeRouter(address(vault), address(usdc));
        vault.setRouter(address(router));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _terms() internal view returns (ILoanRegistry.Terms memory) {
        return ILoanRegistry.Terms({
            borrower: borrower,
            passportId: keccak256("passport-1"),
            principal: PRINCIPAL,
            aprBps: APR_BPS,
            riskBand: 1,
            attestationRef: keccak256("attestation-1"),
            expiry: uint64(block.timestamp + 1 days),
            approved: true
        });
    }

    function _setTerms(ILoanRegistry.Terms memory t) internal {
        vm.prank(forwarder);
        registry.setTerms(t);
    }

    function _fundVault(uint256 amount) internal {
        usdc.mint(lender, amount);
        vm.startPrank(lender);
        usdc.approve(address(vault), amount);
        vault.fund(amount);
        vm.stopPrank();
    }

    function _claim() internal {
        vm.prank(borrower);
        vault.claim();
    }

    /// @dev payer pays `amount` to the router which splits to vault+borrower.
    function _payout(uint256 amount) internal {
        usdc.mint(payer, amount);
        vm.startPrank(payer);
        usdc.approve(address(router), amount);
        router.onPayout(borrower, amount);
        vm.stopPrank();
    }

    // ── disbursement ───────────────────────────────────────────────────────────

    function test_successfulDisbursement() public {
        _fundVault(1_000_000_000); // $1000 pool
        _setTerms(_terms());

        _claim();

        assertEq(usdc.balanceOf(borrower), PRINCIPAL, "borrower receives principal");
        assertEq(usdc.balanceOf(address(vault)), 1_000_000_000 - PRINCIPAL, "vault debited");

        (
            uint256 principal,
            uint256 totalRepayable,
            uint256 outstanding,
            uint256 installmentAmount,
            ,
            ,
            bool disbursed,
            bool repaid
        ) = vault.loans(borrower);

        assertEq(principal, PRINCIPAL);
        assertEq(totalRepayable, EXPECTED_TOTAL);
        assertEq(outstanding, EXPECTED_TOTAL);
        assertEq(installmentAmount, EXPECTED_INSTALLMENT);
        assertTrue(disbursed);
        assertFalse(repaid);
    }

    function test_amortizationIncludesInterest() public {
        _fundVault(1_000_000_000);
        _setTerms(_terms());
        _claim();
        // Sanity: total owed strictly exceeds principal by the simple interest.
        assertEq(EXPECTED_INTEREST, 4_109_589);
        assertEq(vault.outstandingOf(borrower), PRINCIPAL + 4_109_589);
    }

    function test_rejectNotApproved() public {
        _fundVault(1_000_000_000);
        ILoanRegistry.Terms memory t = _terms();
        t.approved = false;
        _setTerms(t);

        vm.prank(borrower);
        vm.expectRevert(LoanVault.NotApproved.selector);
        vault.claim();
    }

    function test_rejectExpired() public {
        _fundVault(1_000_000_000);
        ILoanRegistry.Terms memory t = _terms();
        t.expiry = uint64(block.timestamp + 1 days);
        _setTerms(t);

        vm.warp(block.timestamp + 2 days);

        vm.prank(borrower);
        vm.expectRevert(LoanVault.TermsExpired.selector);
        vault.claim();
    }

    function test_rejectMissingAttestation() public {
        _fundVault(1_000_000_000);
        ILoanRegistry.Terms memory t = _terms();
        t.attestationRef = bytes32(0);
        _setTerms(t);

        vm.prank(borrower);
        vm.expectRevert(LoanVault.MissingAttestation.selector);
        vault.claim();
    }

    function test_rejectDoubleClaim() public {
        _fundVault(1_000_000_000);
        _setTerms(_terms());
        _claim();

        vm.prank(borrower);
        vm.expectRevert(LoanVault.AlreadyDisbursed.selector);
        vault.claim();
    }

    function test_rejectUnderfundedVault() public {
        // Fund less than principal.
        _fundVault(100_000_000); // $100 < $500
        _setTerms(_terms());

        vm.prank(borrower);
        vm.expectRevert(LoanVault.VaultUnderfunded.selector);
        vault.claim();

        // No state should have been written.
        assertEq(vault.outstandingOf(borrower), 0);
    }

    // ── repayment split ─────────────────────────────────────────────────────────

    function test_payoutSplitConservation() public {
        _fundVault(1_000_000_000);
        _setTerms(_terms());
        _claim();

        uint256 payout = 300_000_000; // $300 payout
        uint256 expectedSlice = EXPECTED_INSTALLMENT; // < outstanding and < payout

        _payout(payout);

        // slice + remainder == total
        uint256 remainder = payout - expectedSlice;
        assertEq(usdc.balanceOf(borrower), PRINCIPAL + remainder, "borrower got principal + remainder");
        assertEq(vault.outstandingOf(borrower), EXPECTED_TOTAL - expectedSlice, "outstanding reduced by slice");
        // router holds nothing
        assertEq(usdc.balanceOf(address(router)), 0, "router holds no standing balance");
    }

    function test_repaymentReducesOutstanding() public {
        _fundVault(1_000_000_000);
        _setTerms(_terms());
        _claim();

        uint256 before = vault.outstandingOf(borrower);
        _payout(300_000_000);
        uint256 afterFirst = vault.outstandingOf(borrower);
        assertEq(afterFirst, before - EXPECTED_INSTALLMENT);

        _payout(300_000_000);
        assertEq(vault.outstandingOf(borrower), afterFirst - EXPECTED_INSTALLMENT);
    }

    function test_fullRepaymentMarksRepaid() public {
        _fundVault(1_000_000_000);
        _setTerms(_terms());
        _claim();

        // Pay enough across installments to fully clear. 4 installments of ~$126 each.
        // Use a payout >= installment four times; final slice caps at remaining outstanding.
        for (uint256 i = 0; i < 4; i++) {
            if (vault.isRepaid(borrower)) break;
            _payout(EXPECTED_INSTALLMENT);
        }

        assertTrue(vault.isRepaid(borrower), "loan flagged repaid");
        assertEq(vault.outstandingOf(borrower), 0, "outstanding cleared");
    }

    function test_sliceCappedAtInstallmentNotPayout() public {
        // A single huge payout repays at most ONE scheduled installment; the rest is forwarded
        // to the borrower (auto-repayment is paced by the schedule, not the payout size).
        _fundVault(1_000_000_000);
        _setTerms(_terms());
        _claim();

        uint256 huge = 2_000_000_000; // $2000
        _payout(huge);

        assertFalse(vault.isRepaid(borrower), "one payout only clears one installment");
        assertEq(vault.outstandingOf(borrower), EXPECTED_TOTAL - EXPECTED_INSTALLMENT);
        // borrower got principal + (payout - one installment slice)
        assertEq(usdc.balanceOf(borrower), PRINCIPAL + (huge - EXPECTED_INSTALLMENT));
    }

    function test_finalSliceCapsAtOutstanding() public {
        // The LAST installment slice caps at the remaining outstanding (not the full installment),
        // so over-payment never occurs.
        _fundVault(1_000_000_000);
        _setTerms(_terms());
        _claim();

        // Pay 3 full installments first.
        _payout(EXPECTED_INSTALLMENT);
        _payout(EXPECTED_INSTALLMENT);
        _payout(EXPECTED_INSTALLMENT);

        uint256 remaining = vault.outstandingOf(borrower);
        assertGt(remaining, 0);
        assertLe(remaining, EXPECTED_INSTALLMENT, "remaining is <= one installment");

        // Final payout larger than the remaining: slice caps at `remaining`.
        uint256 finalPayout = EXPECTED_INSTALLMENT;
        uint256 borrowerBefore = usdc.balanceOf(borrower);
        _payout(finalPayout);

        assertTrue(vault.isRepaid(borrower));
        assertEq(vault.outstandingOf(borrower), 0);
        // borrower received the un-applied remainder of the final payout.
        assertEq(usdc.balanceOf(borrower), borrowerBefore + (finalPayout - remaining));
    }

    function test_payoutWithNoLoanForwardsAll() public {
        // No claim -> scheduledSlice == 0 -> entire payout goes to borrower.
        usdc.mint(payer, 200_000_000);
        vm.startPrank(payer);
        usdc.approve(address(router), 200_000_000);
        router.onPayout(borrower, 200_000_000);
        vm.stopPrank();

        assertEq(usdc.balanceOf(borrower), 200_000_000);
        assertEq(vault.outstandingOf(borrower), 0);
    }

    function test_repayOnlyRouter() public {
        _fundVault(1_000_000_000);
        _setTerms(_terms());
        _claim();

        vm.prank(borrower);
        vm.expectRevert(LoanVault.NotRouter.selector);
        vault.repay(borrower, 1_000_000);
    }

    function test_fundZeroReverts() public {
        vm.expectRevert(LoanVault.ZeroAmount.selector);
        vault.fund(0);
    }

    function test_onPayoutZeroReverts() public {
        vm.prank(payer);
        vm.expectRevert(IncomeRouter.ZeroAmount.selector);
        router.onPayout(borrower, 0);
    }
}
