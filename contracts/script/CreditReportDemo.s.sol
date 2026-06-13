// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {IncomeRouter} from "../src/IncomeRouter.sol";
import {PassportRegistry} from "../src/PassportRegistry.sol";
import {TranchePool} from "../src/TranchePool.sol";
import {ILoanRegistry} from "../src/interfaces/ILoanRegistry.sol";
import {IWorldID} from "../src/interfaces/IWorldID.sol";
import {MockERC20} from "../test/MockERC20.sol";
import {MockWorldID} from "../test/MockWorldID.sol";

/// @title CreditReportDemo — the portable, person-bound credit report (Track B reputation lever).
/// @notice A human builds credit history (borrows + repays in full → on-time payment + a laddered
///         limit), then a SECOND lender polls `creditReport` for a DIFFERENT wallet of the same human
///         and reads the IDENTICAL report — proving reputation is bound to the person, not the wallet.
/// @dev    Pure simulation (no anvil/broadcast). Run: `scripts/credit-report-demo.sh`.
contract CreditReportDemo is Script {
    uint256 constant USDC = 1e6;
    uint256 constant ROOT = 1;
    uint256 constant NULLIFIER = uint256(keccak256("human:credit-report-demo"));

    MockERC20 usdc;
    MockWorldID worldId;
    LoanRegistry registry;
    PassportRegistry passport;
    LoanVault vault;
    IncomeRouter router;
    TranchePool pool;

    address operator = address(0xBEEF); // owner + forwarder + the income payer
    address walletA = address(0xA11CE); // the human's first wallet
    address walletB = address(0xB0B); // a different wallet — SAME human

    string[5] STANDING = ["None", "Good", "Late", "Defaulted", "LockedOut"];

    function run() external {
        uint256[8] memory proof;

        // Setup + onboard walletA, fund, write terms, pre-approve the router for repayments.
        vm.startPrank(operator);
        _deploy();
        passport.verifyAndMint(walletA, ROOT, NULLIFIER, proof);
        usdc.mint(operator, 6_000 * USDC);
        usdc.approve(address(vault), 5_000 * USDC);
        vault.fund(5_000 * USDC);
        usdc.approve(address(router), 1_000 * USDC);
        registry.setTerms(
            ILoanRegistry.Terms({
                borrower: walletA,
                passportId: passport.passportIdOf(walletA),
                principal: 500 * USDC,
                aprBps: 1000,
                riskBand: 1,
                attestationRef: keccak256("attestation"),
                expiry: uint64(block.timestamp + 1 days),
                approved: true
            })
        );
        vm.stopPrank();

        // walletA borrows, then repays in full via routed income (4 installments).
        vm.prank(walletA);
        vault.claim();
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(operator);
            router.onPayout(walletA, 150 * USDC);
        }
        require(vault.isRepaid(walletA), "expected fully repaid");

        _h("walletA built credit history (borrowed $500, repaid in full)");
        _report("Lender #1 polls walletA", walletA);

        // A SECOND wallet of the same human links to the same passport (same World nullifier).
        vm.prank(operator);
        passport.verifyAndMint(walletB, ROOT, NULLIFIER, proof);

        _h("A different wallet of the SAME human shows up at a DIFFERENT lender");
        _report("Lender #2 polls walletB (never seen before)", walletB);

        _h("Same person -> same credit report. Reputation travels across wallets + lenders.");
    }

    function _deploy() internal {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        worldId = new MockWorldID();
        registry = new LoanRegistry(operator);
        passport = new PassportRegistry(IWorldID(address(worldId)), "app_vouch_demo", "mint-credit-passport");
        vault = new LoanVault(address(registry), address(usdc), address(0));
        router = new IncomeRouter(address(vault), address(usdc));
        pool = new TranchePool(address(usdc), 600);
        vault.setRouter(address(router));
        vault.setPassportRegistry(address(passport));
        passport.setReputationOracle(address(vault));
        pool.setLossReporter(address(vault));
        vault.setTranchePool(address(pool));
    }

    function _report(string memory who, address wallet) internal view {
        PassportRegistry.CreditReport memory r = passport.creditReport(wallet);
        console2.log(string.concat("  ", who, ":"));
        console2.log("    wallet      ", wallet);
        console2.log("    passportId  ", vm.toString(r.passportId));
        console2.log("    standing    ", STANDING[uint8(r.standing)]);
        console2.log("    score       ", r.score);
        console2.log("    limit (USDC)", r.limit / USDC);
        console2.log("    on-time     ", r.onTimePayments);
        console2.log("    late        ", r.latePayments);
        console2.log("    defaults    ", r.defaults);
    }

    function _h(string memory s) internal pure {
        console2.log("");
        console2.log(string.concat("== ", s, " =="));
    }
}
