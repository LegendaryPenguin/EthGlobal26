// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";
import {ILoanRegistry} from "../src/interfaces/ILoanRegistry.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {IncomeRouter} from "../src/IncomeRouter.sol";
import {PassportRegistry} from "../src/PassportRegistry.sol";
import {TranchePool} from "../src/TranchePool.sol";
import {IWorldID} from "../src/interfaces/IWorldID.sol";
import {MockWorldID} from "./MockWorldID.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Stage 8 — default handling + repayment reputation. The overdue/default state machine on
///         the LoanVault, its junior-first loss report into the TranchePool, and the reputation
///         transitions (heal/ladder on repayment, lockout on default) on the PassportRegistry.
contract Stage8DefaultTest is Test {
    LoanRegistry registry;
    LoanVault vault;
    IncomeRouter router;
    PassportRegistry passport;
    TranchePool pool;
    MockWorldID worldId;
    MockERC20 usdc;

    address forwarder = makeAddr("creForwarder");
    address payer = makeAddr("creatorPlatform");
    address keeper = makeAddr("randomKeeper"); // a permissionless caller of markLate/markDefault

    address tunde = makeAddr("tunde");
    address tundeRespawn = makeAddr("tundeRespawn"); // same human, fresh wallet

    // senior/junior lenders
    address alice = makeAddr("aliceSenior");
    address bob = makeAddr("bobJunior");

    uint256 constant NULLIFIER = uint256(keccak256("tunde-human"));
    uint256 constant ROOT = 999;
    uint256[8] proof;

    uint256 constant PRINCIPAL = 500_000_000; // $500
    uint16 constant APR_BPS = 1000; // 10%
    uint256 constant EXPECTED_INTEREST = (PRINCIPAL * APR_BPS * 30) / (10_000 * 365); // 4_109_589
    uint256 constant EXPECTED_TOTAL = PRINCIPAL + EXPECTED_INTEREST;
    uint256 constant EXPECTED_INSTALLMENT = (EXPECTED_TOTAL + 3) / 4;

    uint256 constant TERM = 30 days;
    uint256 constant GRACE = 3 days;

    TranchePool.Tranche constant SENIOR = TranchePool.Tranche.Senior;
    TranchePool.Tranche constant JUNIOR = TranchePool.Tranche.Junior;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        registry = new LoanRegistry(forwarder);
        worldId = new MockWorldID();
        passport = new PassportRegistry(IWorldID(address(worldId)), "app_vouch", "mint-credit-passport");

        vault = new LoanVault(address(registry), address(usdc), address(0));
        router = new IncomeRouter(address(vault), address(usdc));
        pool = new TranchePool(address(usdc), 600);

        vault.setRouter(address(router));
        vault.setPassportRegistry(address(passport));

        // Stage 8 wiring: vault is the reputation oracle + the pool's loss reporter.
        passport.setReputationOracle(address(vault));
        pool.setLossReporter(address(vault));
        vault.setTranchePool(address(pool));

        // Seed lender tranches: 80k senior / 20k junior. Deploy 5k into the vault as lending capital.
        _deposit(alice, SENIOR, 80_000e6);
        _deposit(bob, JUNIOR, 20_000e6);
        pool.deployToVault(address(vault), 5_000e6);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _deposit(address who, TranchePool.Tranche tranche, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(pool), amount);
        pool.deposit(tranche, amount);
        vm.stopPrank();
    }

    function _mintPassport(address wallet) internal {
        passport.verifyAndMint(wallet, ROOT, NULLIFIER, proof);
    }

    function _approve(address borrower) internal {
        ILoanRegistry.Terms memory t = ILoanRegistry.Terms({
            borrower: borrower,
            passportId: passport.passportIdOf(borrower),
            principal: PRINCIPAL,
            aprBps: APR_BPS,
            riskBand: 1,
            attestationRef: keccak256("attestation"),
            expiry: uint64(block.timestamp + 1 days),
            approved: true
        });
        vm.prank(forwarder);
        registry.setTerms(t);
    }

    function _claim(address borrower) internal {
        vm.prank(borrower);
        vault.claim();
    }

    function _payout(address borrower, uint256 amount) internal {
        usdc.mint(payer, amount);
        vm.startPrank(payer);
        usdc.approve(address(router), amount);
        router.onPayout(borrower, amount);
        vm.stopPrank();
    }

    function _verifyApproveClaim(address borrower) internal {
        _mintPassport(borrower);
        _approve(borrower);
        _claim(borrower);
    }

    // ── full repayment heals + ladders + bumps score ──────────────────────────

    function test_fullRepaymentHealsLateAndLaddersLimit() public {
        _verifyApproveClaim(tunde);

        // Borrower falls behind, gets dinged Late.
        vm.warp(block.timestamp + 12 days);
        vault.markLate(tunde);
        assertEq(uint8(passport.standingOf(tunde)), uint8(PassportRegistry.Standing.Late), "dinged late");
        assertTrue(passport.isInGoodStanding(tunde), "late still allowed to borrow");

        uint256 limitBefore = passport.limitOf(tunde); // INITIAL_LIMIT, $500
        assertEq(limitBefore, passport.INITIAL_LIMIT());

        // Now they fully repay across the four installments.
        for (uint256 i = 0; i < 4; i++) {
            if (vault.isRepaid(tunde)) break;
            _payout(tunde, EXPECTED_INSTALLMENT);
        }
        assertTrue(vault.isRepaid(tunde), "loan fully repaid");

        // Reputation healed Late → Good, score bumped, limit laddered up by INITIAL_LIMIT/2 ($250).
        assertEq(uint8(passport.standingOf(tunde)), uint8(PassportRegistry.Standing.Good), "healed to Good");
        assertEq(passport.limitOf(tunde), limitBefore + passport.INITIAL_LIMIT() / 2, "limit laddered up");
        (, , , uint32 score) = passport.passports(NULLIFIER);
        assertEq(score, passport.REPAYMENT_SCORE_BUMP(), "score bumped (started 0, late penalty floored at 0)");
    }

    function test_fullRepaymentNoPassportIsNoop() public {
        // Borrower never minted a passport (gate off via address(0) on a fresh vault).
        LoanVault v2 = new LoanVault(address(registry), address(usdc), address(0));
        IncomeRouter r2 = new IncomeRouter(address(v2), address(usdc));
        v2.setRouter(address(r2));
        v2.setPassportRegistry(address(passport)); // wired, but borrower has no passport
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(v2), 1_000e6);
        v2.fund(1_000e6);

        _approve(tunde); // approved on seam; but no passport → gate would block. Use a vault w/o gate.
        // Instead exercise recordFullRepayment no-op directly via the registry authority path:
        // calling recordFullRepayment for a wallet with no passport must not revert.
        vm.prank(address(vault)); // vault is the reputation oracle
        passport.recordFullRepayment(makeAddr("ghost"));
        // No revert == pass.
    }

    // ── markDefault timing + permissionless + lockout + loss ───────────────────

    function test_markDefaultRevertsBeforeTermPlusGrace() public {
        _verifyApproveClaim(tunde);

        // Just before term + grace fully elapses.
        vm.warp(block.timestamp + TERM + GRACE - 1);
        vm.prank(keeper);
        vm.expectRevert(LoanVault.TermNotElapsed.selector);
        vault.markDefault(tunde);
    }

    function test_markDefaultPermissionlessAfterTermPlusGrace() public {
        _verifyApproveClaim(tunde);

        uint256 juniorBefore = pool.juniorTotal();
        uint256 seniorBefore = pool.seniorTotal();

        // Term + grace fully elapsed, still fully owing (no repayments).
        vm.warp(block.timestamp + TERM + GRACE);

        // A random address (not owner, not borrower) can call it — permissionless.
        vm.prank(keeper);
        vault.markDefault(tunde);

        // Defaulted flag set.
        (, , , , , , , , bool defaulted) = vault.loans(tunde);
        assertTrue(defaulted, "loan flagged defaulted");

        // Human locked out network-wide.
        assertEq(uint8(passport.standingOf(tunde)), uint8(PassportRegistry.Standing.LockedOut), "locked out");
        assertEq(passport.limitOf(tunde), 0, "limit zeroed");
        assertFalse(passport.isInGoodStanding(tunde), "cannot borrow after default");

        // Junior tranche absorbed the loss = full unrecovered principal ($500, nothing repaid).
        uint256 loss = PRINCIPAL; // repaidSoFar == 0
        assertEq(pool.juniorTotal(), juniorBefore - loss, "junior absorbed unrecovered principal");
        assertEq(pool.seniorTotal(), seniorBefore, "senior protected (loss < junior buffer)");
    }

    function test_markDefaultLossIsUnrecoveredPrincipalOnly() public {
        _verifyApproveClaim(tunde);

        // Borrower repays two installments (~$253) then walks away. repaidSoFar offsets principal loss.
        _payout(tunde, EXPECTED_INSTALLMENT);
        _payout(tunde, EXPECTED_INSTALLMENT);
        uint256 paid = vault.repaidSoFar(tunde);
        assertEq(paid, 2 * EXPECTED_INSTALLMENT, "two installments applied");

        uint256 juniorBefore = pool.juniorTotal();

        vm.warp(block.timestamp + TERM + GRACE);
        vm.prank(keeper);
        vault.markDefault(tunde);

        // capitalLoss = principal - repaidSoFar (interest is recognized only as paid, not a pool loss).
        uint256 expectedLoss = PRINCIPAL - paid;
        assertEq(pool.juniorTotal(), juniorBefore - expectedLoss, "loss = unrecovered principal");
    }

    function test_markDefaultRevertsIfRepaid() public {
        _verifyApproveClaim(tunde);
        for (uint256 i = 0; i < 4; i++) {
            if (vault.isRepaid(tunde)) break;
            _payout(tunde, EXPECTED_INSTALLMENT);
        }
        vm.warp(block.timestamp + TERM + GRACE);
        vm.prank(keeper);
        vm.expectRevert(LoanVault.AlreadyRepaid.selector);
        vault.markDefault(tunde);
    }

    function test_markDefaultNotTwice() public {
        _verifyApproveClaim(tunde);
        vm.warp(block.timestamp + TERM + GRACE);
        vault.markDefault(tunde);
        vm.expectRevert(LoanVault.AlreadyDefaulted.selector);
        vault.markDefault(tunde);
    }

    // ── end-to-end: real default drives the respawn rejection ──────────────────

    function test_defaultDrivesRespawnRejection() public {
        _verifyApproveClaim(tunde);

        vm.warp(block.timestamp + TERM + GRACE);
        vm.prank(keeper);
        vault.markDefault(tunde); // real default → human LockedOut

        // The respawn attempt: a fresh wallet, same human, can't even re-mint.
        vm.expectRevert(PassportRegistry.HumanLockedOut.selector);
        passport.verifyAndMint(tundeRespawn, ROOT, NULLIFIER, proof);
    }

    // ── markLate dings but borrower can still borrow ───────────────────────────

    function test_markLateGoodToLateStillAllowedToBorrow() public {
        _verifyApproveClaim(tunde);

        assertEq(uint8(passport.standingOf(tunde)), uint8(PassportRegistry.Standing.Good));

        // One installment is due by ~7.5d; grace pushes the markable point to ~10.5d. At +12d it's late.
        vm.warp(block.timestamp + 12 days);

        vm.prank(keeper); // permissionless
        vault.markLate(tunde);

        assertEq(uint8(passport.standingOf(tunde)), uint8(PassportRegistry.Standing.Late), "Good to Late");
        // Late is still good-standing for the borrow gate.
        assertTrue(passport.isInGoodStanding(tunde), "Late can still borrow");
    }

    function test_markLateRevertsBeforeGrace() public {
        _verifyApproveClaim(tunde);
        // +8 days: one installment due (7.5d) but grace (10.5d) not yet elapsed.
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(LoanVault.GraceNotElapsed.selector);
        vault.markLate(tunde);
    }

    function test_markLateRevertsIfOnSchedule() public {
        _verifyApproveClaim(tunde);
        // Pay the first installment, then check at +12d: paid >= expected → not behind.
        _payout(tunde, EXPECTED_INSTALLMENT);
        vm.warp(block.timestamp + 12 days);
        // At +12d, ~1 installment is due and exactly 1 is paid → on schedule.
        vm.expectRevert(LoanVault.NotBehindSchedule.selector);
        vault.markLate(tunde);
    }

    function test_markLateRevertsAfterTermEnded() public {
        _verifyApproveClaim(tunde);
        vm.warp(block.timestamp + TERM + 1);
        vm.expectRevert(LoanVault.TermEnded.selector);
        vault.markLate(tunde);
    }

    function test_expectedRepaidSchedule() public {
        _verifyApproveClaim(tunde);
        uint256 start = block.timestamp;

        // installmentInterval = 7.5 days.
        vm.warp(start + 7 days);
        assertEq(vault.expectedRepaid(tunde), 0, "before first interval, nothing due");

        vm.warp(start + 8 days); // > 7.5d → 1 installment due
        assertEq(vault.expectedRepaid(tunde), EXPECTED_INSTALLMENT);

        vm.warp(start + 16 days); // > 15d → 2 installments due
        assertEq(vault.expectedRepaid(tunde), 2 * EXPECTED_INSTALLMENT);

        vm.warp(start + TERM); // term end → all of totalRepayable due (capped)
        assertEq(vault.expectedRepaid(tunde), EXPECTED_TOTAL);
    }

    // ── access control on new authority-gated functions ───────────────────────

    function test_recordLatenessOnlyAuthority() public {
        _verifyApproveClaim(tunde);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(PassportRegistry.NotAuthorized.selector);
        passport.recordLateness(tunde);
    }

    function test_recordDefaultOnlyAuthority() public {
        _verifyApproveClaim(tunde);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(PassportRegistry.NotAuthorized.selector);
        passport.recordDefault(tunde);
    }

    function test_recordFullRepaymentOnlyAuthority() public {
        _verifyApproveClaim(tunde);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(PassportRegistry.NotAuthorized.selector);
        passport.recordFullRepayment(tunde);
    }

    function test_cureOnlyAuthority() public {
        _verifyApproveClaim(tunde);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(PassportRegistry.NotAuthorized.selector);
        passport.cure(tunde, 100_000_000);
    }

    function test_cureReentersLockedOutHumanAtLowLimit() public {
        _verifyApproveClaim(tunde);
        vm.warp(block.timestamp + TERM + GRACE);
        vault.markDefault(tunde);
        assertEq(uint8(passport.standingOf(tunde)), uint8(PassportRegistry.Standing.LockedOut));

        // Authority cures: re-enter at a low limit, on probation (Late).
        passport.cure(tunde, 100_000_000); // $100
        assertEq(uint8(passport.standingOf(tunde)), uint8(PassportRegistry.Standing.Late), "re-enter on probation");
        assertEq(passport.limitOf(tunde), 100_000_000, "low re-entry limit");
        assertTrue(passport.isInGoodStanding(tunde), "can borrow again after cure");
    }

    function test_setLossReporterOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(TranchePool.NotOwner.selector);
        pool.setLossReporter(address(0xdead));
    }

    function test_absorbLossRejectsRandomCaller() public {
        // A non-owner, non-reporter cannot absorb loss directly on the pool (reuses NotOwner selector).
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(TranchePool.NotOwner.selector);
        pool.absorbLoss(1_000e6);
    }

    function test_setTranchePoolOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(LoanVault.NotOwner.selector);
        vault.setTranchePool(address(0xdead));
    }

    // ── optional-gate behavior: vault w/o pool/passport still defaults cleanly ──

    function test_markDefaultWithoutPoolOrPassportStillWorks() public {
        // Fresh vault with NO tranche pool and NO passport registry — mirrors existing tests' setup.
        LoanVault v2 = new LoanVault(address(registry), address(usdc), address(0));
        IncomeRouter r2 = new IncomeRouter(address(v2), address(usdc));
        v2.setRouter(address(r2));

        // Fund + approve + claim (no gate since passportRegistry unset).
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(v2), 1_000e6);
        v2.fund(1_000e6);
        _approve(tunde);
        vm.prank(tunde);
        v2.claim();

        vm.warp(block.timestamp + TERM + GRACE);
        vm.prank(keeper);
        v2.markDefault(tunde); // must not revert despite no pool/passport wired

        (, , , , , , , , bool defaulted) = v2.loans(tunde);
        assertTrue(defaulted, "defaulted even without pool/passport");
    }
}
