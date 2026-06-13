// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TranchePool} from "../src/TranchePool.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Stage 6 (lender side) + Stage 8 — senior/junior tranche pool with a yield waterfall.
///         Shares-per-tranche accounting; senior fixed-rate-first, junior residual; loss hits
///         junior first; pooled capital deploys into a real LoanVault via its existing fund().
contract TranchePoolTest is Test {
    TranchePool pool;
    MockERC20 usdc;

    address owner = address(this); // deployer is owner
    address alice = makeAddr("alice"); // senior lender
    address bob = makeAddr("bob"); // junior lender
    address protocol = makeAddr("protocol"); // pushes interest in

    // Realistic 6-dec amounts: an 80/20 senior/junior split of a $100k pool.
    uint256 constant SENIOR_DEPOSIT = 80_000e6;
    uint256 constant JUNIOR_DEPOSIT = 20_000e6;
    uint16 constant SENIOR_RATE_BPS = 600; // 6.00% APY

    TranchePool.Tranche constant SENIOR = TranchePool.Tranche.Senior;
    TranchePool.Tranche constant JUNIOR = TranchePool.Tranche.Junior;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        pool = new TranchePool(address(usdc), SENIOR_RATE_BPS);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _deposit(address who, TranchePool.Tranche tranche, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(pool), amount);
        pool.deposit(tranche, amount);
        vm.stopPrank();
    }

    function _distribute(uint256 amount) internal {
        usdc.mint(protocol, amount);
        vm.startPrank(protocol);
        usdc.approve(address(pool), amount);
        pool.distributeInterest(amount);
        vm.stopPrank();
    }

    function _seedBothTranches() internal {
        _deposit(alice, SENIOR, SENIOR_DEPOSIT);
        _deposit(bob, JUNIOR, JUNIOR_DEPOSIT);
    }

    // ── deposits ───────────────────────────────────────────────────────────────

    function test_depositCreditsRightTranche() public {
        _seedBothTranches();

        assertEq(pool.seniorTotal(), SENIOR_DEPOSIT, "senior total credited");
        assertEq(pool.juniorTotal(), JUNIOR_DEPOSIT, "junior total credited");
        assertEq(pool.assetsOf(alice, SENIOR), SENIOR_DEPOSIT, "alice senior assets");
        assertEq(pool.assetsOf(bob, JUNIOR), JUNIOR_DEPOSIT, "bob junior assets");
        // No cross-contamination across tranches.
        assertEq(pool.assetsOf(alice, JUNIOR), 0);
        assertEq(pool.assetsOf(bob, SENIOR), 0);
        // Pool holds the USDC.
        assertEq(usdc.balanceOf(address(pool)), SENIOR_DEPOSIT + JUNIOR_DEPOSIT);
    }

    function test_depositRequiresApproval() public {
        usdc.mint(alice, SENIOR_DEPOSIT);
        vm.prank(alice);
        vm.expectRevert(); // MockERC20 reverts on insufficient allowance
        pool.deposit(SENIOR, SENIOR_DEPOSIT);
    }

    function test_depositZeroReverts() public {
        vm.expectRevert(TranchePool.ZeroAmount.selector);
        pool.deposit(SENIOR, 0);
    }

    function test_secondDepositorGetsProportionalShares() public {
        _deposit(alice, SENIOR, SENIOR_DEPOSIT);
        address carol = makeAddr("carol");
        _deposit(carol, SENIOR, SENIOR_DEPOSIT); // same amount, no yield yet

        assertEq(pool.assetsOf(alice, SENIOR), SENIOR_DEPOSIT);
        assertEq(pool.assetsOf(carol, SENIOR), SENIOR_DEPOSIT);
        assertEq(pool.seniorTotal(), 2 * SENIOR_DEPOSIT);
    }

    // ── withdraw ─────────────────────────────────────────────────────────────

    function test_withdrawReturnsPrincipal() public {
        _seedBothTranches();

        vm.prank(alice);
        pool.withdraw(SENIOR, SENIOR_DEPOSIT);

        assertEq(usdc.balanceOf(alice), SENIOR_DEPOSIT, "alice got principal back");
        assertEq(pool.assetsOf(alice, SENIOR), 0, "alice position cleared");
        assertEq(pool.seniorTotal(), 0, "senior total drained");
    }

    function test_partialWithdraw() public {
        _seedBothTranches();
        uint256 half = SENIOR_DEPOSIT / 2;

        vm.prank(alice);
        pool.withdraw(SENIOR, half);

        assertEq(usdc.balanceOf(alice), half);
        assertEq(pool.assetsOf(alice, SENIOR), SENIOR_DEPOSIT - half);
    }

    function test_withdrawMoreThanPositionReverts() public {
        _seedBothTranches();
        vm.prank(alice);
        vm.expectRevert(TranchePool.InsufficientShares.selector);
        pool.withdraw(SENIOR, SENIOR_DEPOSIT + 1);
    }

    function test_withdrawBeyondLiquidityReverts() public {
        _seedBothTranches();
        // Deploy most of the senior capital into the vault, leaving the pool short of cash.
        LoanVault vault = _newVault();
        pool.deployToVault(address(vault), 90_000e6); // leaves 10k in pool

        vm.prank(alice);
        vm.expectRevert(TranchePool.InsufficientLiquidity.selector);
        pool.withdraw(SENIOR, SENIOR_DEPOSIT); // wants 80k, only 10k on hand
    }

    // ── interest waterfall ──────────────────────────────────────────────────────

    function test_seniorGetsFixedShareJuniorResidual() public {
        _seedBothTranches();

        // Advance one year so senior's 6% accrual is the full 6% of its assets.
        vm.warp(block.timestamp + 365 days);

        // Borrowers paid in $10k of interest this period.
        uint256 interest = 10_000e6;
        // Senior's fixed slice over a full year @ 6% on 80k = 4_800e6.
        uint256 expectedSenior = (SENIOR_DEPOSIT * SENIOR_RATE_BPS) / 10_000; // 4_800e6
        uint256 expectedJunior = interest - expectedSenior; // residual = 5_200e6

        _distribute(interest);

        assertEq(pool.assetsOf(alice, SENIOR), SENIOR_DEPOSIT + expectedSenior, "senior principal + fixed");
        assertEq(pool.assetsOf(bob, JUNIOR), JUNIOR_DEPOSIT + expectedJunior, "junior principal + residual");
        // Conservation: all interest accounted for.
        assertEq(expectedSenior + expectedJunior, interest);
    }

    function test_juniorEarnsHigherYieldThanSenior() public {
        _seedBothTranches();
        vm.warp(block.timestamp + 365 days);

        uint256 interest = 10_000e6;
        _distribute(interest);

        uint256 seniorYield = pool.assetsOf(alice, SENIOR) - SENIOR_DEPOSIT;
        uint256 juniorYield = pool.assetsOf(bob, JUNIOR) - JUNIOR_DEPOSIT;

        // Junior APY = juniorYield / juniorPrincipal; senior APY = seniorYield / seniorPrincipal.
        // 5200/20000 = 26% vs 4800/80000 = 6% — junior takes the higher risk-priced yield.
        uint256 seniorApyBps = (seniorYield * 10_000) / SENIOR_DEPOSIT;
        uint256 juniorApyBps = (juniorYield * 10_000) / JUNIOR_DEPOSIT;
        assertEq(seniorApyBps, 600, "senior ~6%");
        assertEq(juniorApyBps, 2600, "junior ~26% (the docs/01 worked example)");
        assertGt(juniorApyBps, seniorApyBps);
    }

    function test_seniorCappedWhenInterestBelowAccrual() public {
        _seedBothTranches();
        vm.warp(block.timestamp + 365 days);

        // Only $3k of interest arrives, less than senior's $4.8k full-year accrual.
        uint256 interest = 3_000e6;
        _distribute(interest);

        // Senior takes all of it; junior gets nothing this period.
        assertEq(pool.assetsOf(alice, SENIOR), SENIOR_DEPOSIT + interest);
        assertEq(pool.assetsOf(bob, JUNIOR), JUNIOR_DEPOSIT);
    }

    function test_distributeWithNoJuniorAllToSenior() public {
        _deposit(alice, SENIOR, SENIOR_DEPOSIT);
        vm.warp(block.timestamp + 365 days);

        uint256 interest = 10_000e6; // more than the 6% accrual but no junior to take residual
        _distribute(interest);

        assertEq(pool.assetsOf(alice, SENIOR), SENIOR_DEPOSIT + interest, "senior keeps all w/o junior");
    }

    function test_distributeZeroReverts() public {
        _seedBothTranches();
        vm.expectRevert(TranchePool.ZeroAmount.selector);
        pool.distributeInterest(0);
    }

    function test_distributeEmptyPoolReverts() public {
        usdc.mint(protocol, 1_000e6);
        vm.startPrank(protocol);
        usdc.approve(address(pool), 1_000e6);
        vm.expectRevert(TranchePool.NothingToDistribute.selector);
        pool.distributeInterest(1_000e6);
        vm.stopPrank();
    }

    // ── loss absorption (junior first) ───────────────────────────────────────────

    function test_lossHitsJuniorFirst() public {
        _seedBothTranches();

        uint256 loss = 5_000e6; // < junior's 20k buffer
        pool.absorbLoss(loss);

        assertEq(pool.juniorTotal(), JUNIOR_DEPOSIT - loss, "junior absorbs the loss");
        assertEq(pool.seniorTotal(), SENIOR_DEPOSIT, "senior fully protected");
        assertEq(pool.assetsOf(bob, JUNIOR), JUNIOR_DEPOSIT - loss);
        assertEq(pool.assetsOf(alice, SENIOR), SENIOR_DEPOSIT);
    }

    function test_lossSpillsToSeniorOnlyAfterJuniorWiped() public {
        _seedBothTranches();

        // A loss bigger than the entire junior buffer (20k). Spillover = 5k onto senior.
        uint256 loss = 25_000e6;
        (uint256 fromJunior, uint256 fromSenior) = pool.absorbLoss(loss);

        assertEq(fromJunior, JUNIOR_DEPOSIT, "junior fully wiped first");
        assertEq(fromSenior, 5_000e6, "only the spillover hits senior");
        assertEq(pool.juniorTotal(), 0, "junior wiped");
        assertEq(pool.seniorTotal(), SENIOR_DEPOSIT - 5_000e6, "senior took spillover");
        assertEq(pool.assetsOf(bob, JUNIOR), 0);
        assertEq(pool.assetsOf(alice, SENIOR), SENIOR_DEPOSIT - 5_000e6);
    }

    function test_lossCappedAtTotalAssets() public {
        _seedBothTranches();
        // Catastrophic loss bigger than the whole pool: caps at junior+senior.
        (uint256 fromJunior, uint256 fromSenior) = pool.absorbLoss(1_000_000e6);
        assertEq(fromJunior, JUNIOR_DEPOSIT);
        assertEq(fromSenior, SENIOR_DEPOSIT);
        assertEq(pool.juniorTotal(), 0);
        assertEq(pool.seniorTotal(), 0);
    }

    function test_absorbLossOnlyOwner() public {
        _seedBothTranches();
        vm.prank(alice);
        vm.expectRevert(TranchePool.NotOwner.selector);
        pool.absorbLoss(1_000e6);
    }

    // ── deployToVault into a REAL LoanVault ──────────────────────────────────────

    function _newVault() internal returns (LoanVault vault) {
        address forwarder = makeAddr("forwarder");
        LoanRegistry registry = new LoanRegistry(forwarder);
        vault = new LoanVault(address(registry), address(usdc), address(0));
    }

    function test_deployToVaultFundsRealVault() public {
        _seedBothTranches();
        LoanVault vault = _newVault();

        uint256 deployAmount = 60_000e6;
        uint256 poolBefore = usdc.balanceOf(address(pool));

        pool.deployToVault(address(vault), deployAmount);

        assertEq(usdc.balanceOf(address(vault)), deployAmount, "vault funded");
        assertEq(usdc.balanceOf(address(pool)), poolBefore - deployAmount, "pool debited");
        // No lingering allowance left on the vault.
        assertEq(usdc.allowance(address(pool), address(vault)), 0, "allowance reset");
        // Tranche accounting is unchanged — capital is deployed, not lost; still owed to lenders.
        assertEq(pool.seniorTotal(), SENIOR_DEPOSIT);
        assertEq(pool.juniorTotal(), JUNIOR_DEPOSIT);
    }

    function test_deployToVaultOnlyOwner() public {
        _seedBothTranches();
        LoanVault vault = _newVault();
        vm.prank(alice);
        vm.expectRevert(TranchePool.NotOwner.selector);
        pool.deployToVault(address(vault), 10_000e6);
    }

    function test_deployBeyondLiquidityReverts() public {
        _seedBothTranches();
        LoanVault vault = _newVault();
        vm.expectRevert(TranchePool.InsufficientLiquidity.selector);
        pool.deployToVault(address(vault), 200_000e6);
    }

    // ── full lifecycle: deploy → interest comes back → lenders withdraw with yield ──

    function test_lifecycleDeployInterestWithdraw() public {
        _seedBothTranches();
        LoanVault vault = _newVault();

        // Deploy 50k of capital into the vault as loans.
        pool.deployToVault(address(vault), 50_000e6);
        // Pool now holds 50k cash, 50k deployed.
        assertEq(usdc.balanceOf(address(pool)), 50_000e6);

        // A year passes; borrowers repaid interest; protocol routes 10k interest back into the pool.
        vm.warp(block.timestamp + 365 days);
        _distribute(10_000e6);

        // Senior earned its 6% fixed (4.8k); junior the 5.2k residual.
        assertEq(pool.assetsOf(alice, SENIOR), SENIOR_DEPOSIT + 4_800e6);
        assertEq(pool.assetsOf(bob, JUNIOR), JUNIOR_DEPOSIT + 5_200e6);

        // Pool cash is now 50k + 10k interest = 60k. Junior (25.2k) can fully exit.
        uint256 bobAssets = pool.assetsOf(bob, JUNIOR);
        vm.prank(bob);
        pool.withdraw(JUNIOR, bobAssets);
        assertEq(usdc.balanceOf(bob), bobAssets, "junior withdrew principal + residual yield");
    }

    // ── admin ────────────────────────────────────────────────────────────────

    function test_setSeniorRateBps() public {
        pool.setSeniorRateBps(800);
        assertEq(pool.seniorRateBps(), 800);
    }

    function test_setSeniorRateBpsOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(TranchePool.NotOwner.selector);
        pool.setSeniorRateBps(800);
    }

    function test_setSeniorRateTooHighReverts() public {
        vm.expectRevert(TranchePool.RateTooHigh.selector);
        pool.setSeniorRateBps(10_001);
    }

    function test_constructorRejectsZeroUsdc() public {
        vm.expectRevert(TranchePool.ZeroAddress.selector);
        new TranchePool(address(0), 600);
    }
}
