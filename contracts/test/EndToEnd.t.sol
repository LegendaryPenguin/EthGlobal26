// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";
import {ILoanRegistry} from "../src/interfaces/ILoanRegistry.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {IncomeRouter} from "../src/IncomeRouter.sol";
import {PassportRegistry} from "../src/PassportRegistry.sol";
import {IWorldID} from "../src/interfaces/IWorldID.sol";
import {MockWorldID} from "./MockWorldID.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice The whole loop wired together — the three demo money-shots as one test:
///   1. Borrow with invisible income: verify human → approved verdict on the seam → claim → USDC.
///   2. The defaulter who can't respawn: a locked-out human's new wallet is rejected.
///   3. Money that repays itself: a mock payout splits slice → loan, remainder → borrower.
contract EndToEndTest is Test {
    LoanRegistry registry;
    LoanVault vault;
    IncomeRouter router;
    PassportRegistry passport;
    MockWorldID worldId;
    MockERC20 usdc;

    address forwarder = makeAddr("creForwarder"); // the Chainlink CRE Forwarder
    address payer = makeAddr("creatorPlatform"); // the payout source
    address funder = makeAddr("lender"); // seeds the pool

    address tunde = makeAddr("tunde");
    address tundeRespawn = makeAddr("tundeRespawn"); // same human, fresh wallet

    uint256 constant NULLIFIER = uint256(keccak256("tunde-human"));
    uint256 constant ROOT = 999;
    uint256[8] proof;

    uint256 constant PRINCIPAL = 500_000_000; // $500, 6 decimals

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        registry = new LoanRegistry(forwarder);
        worldId = new MockWorldID();
        passport = new PassportRegistry(IWorldID(address(worldId)), "app_vouch", "mint-credit-passport");

        vault = new LoanVault(address(registry), address(usdc), address(0));
        router = new IncomeRouter(address(vault), address(usdc));
        vault.setRouter(address(router));
        vault.setPassportRegistry(address(passport)); // turn on the Stage 4 gate

        // Seed the lending pool with $5,000.
        usdc.mint(funder, 5_000_000_000);
        vm.startPrank(funder);
        usdc.approve(address(vault), type(uint256).max);
        vault.fund(5_000_000_000);
        vm.stopPrank();
    }

    function _approve(address borrower) internal {
        ILoanRegistry.Terms memory t = ILoanRegistry.Terms({
            borrower: borrower,
            passportId: passport.passportIdOf(borrower),
            principal: PRINCIPAL,
            aprBps: 1000,
            riskBand: 1,
            attestationRef: keccak256("attestation"),
            expiry: uint64(block.timestamp + 1 days),
            approved: true
        });
        vm.prank(forwarder);
        registry.setTerms(t);
    }

    /// Money-shot #1 + #3: verify → approve → claim → disburse → payout splits and repays.
    function test_fullBorrowDisburseRepayLoop() public {
        // 1. Tunde proves he's a unique human → passport minted, good standing.
        passport.verifyAndMint(tunde, ROOT, NULLIFIER, proof);
        assertTrue(passport.isInGoodStanding(tunde));

        // 2. The CRE workflow lands an approved verdict on the seam (only the verdict — no income).
        _approve(tunde);

        // 3. Tunde claims → USDC disburses on Arc in seconds.
        vm.prank(tunde);
        vault.claim();
        assertEq(usdc.balanceOf(tunde), PRINCIPAL, "principal disbursed");

        uint256 outstanding = vault.outstandingOf(tunde);
        assertGt(outstanding, PRINCIPAL, "outstanding includes interest");

        // 4. A creator payout of $900 arrives; the router splits it.
        uint256 payout = 900_000_000;
        usdc.mint(payer, payout);
        vm.startPrank(payer);
        usdc.approve(address(router), payout);
        router.onPayout(tunde, payout);
        vm.stopPrank();

        // The slice was one installment (capped at outstanding); remainder went to Tunde.
        uint256 repaid = outstanding - vault.outstandingOf(tunde);
        assertGt(repaid, 0, "some repayment applied");
        // Tunde keeps disbursed principal + (payout - repaid).
        assertEq(usdc.balanceOf(tunde), PRINCIPAL + (payout - repaid), "remainder forwarded to borrower");
    }

    /// Money-shot #2: the defaulter who can't respawn.
    function test_lockedOutHumanCannotRespawn() public {
        passport.verifyAndMint(tunde, ROOT, NULLIFIER, proof);

        // Tunde walks away from a loan → his human is locked out network-wide.
        passport.setStanding(NULLIFIER, PassportRegistry.Standing.LockedOut, 0, 0);

        // Identity-level rejection: a fresh wallet, same human, can't even re-mint.
        vm.expectRevert(PassportRegistry.HumanLockedOut.selector);
        passport.verifyAndMint(tundeRespawn, ROOT, NULLIFIER, proof);

        // Money-level rejection: even with approved terms, the vault gate blocks an out-of-standing
        // borrower. (Approve the original wallet, whose human is now locked out.)
        _approve(tunde);
        vm.prank(tunde);
        vm.expectRevert(LoanVault.NotInGoodStanding.selector);
        vault.claim();
    }

    /// An unverified wallet (no passport) cannot claim even with approved terms.
    function test_unverifiedWalletBlockedByGate() public {
        _approve(tunde); // approved on the seam, but never did World ID
        vm.prank(tunde);
        vm.expectRevert(LoanVault.NotInGoodStanding.selector);
        vault.claim();
    }
}
