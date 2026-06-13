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

/// @title RespawnDemo — the Track B money-shot, headless and recordable (no anvil / broadcast needed).
/// @notice Proves the anti-respawn lifecycle end to end:
///           verified human borrows → defaults (term + grace elapse) → human LOCKED OUT →
///           a FRESH wallet (same human) tries to re-verify → REJECTED on-chain (HumanLockedOut).
///         Run: `scripts/respawn-demo.sh` (or `forge script script/RespawnDemo.s.sol -vv`).
/// @dev    Pure simulation so vm.warp can fast-forward past the loan term — this shows the on-chain
///         rule biting, not a live deploy. An `operator` EOA owns/forwards (scripts can't use address(this)).
contract RespawnDemo is Script {
    uint256 constant USDC = 1e6;
    uint256 constant ROOT = 1;
    uint256 constant NULLIFIER = uint256(keccak256("human:respawn-demo")); // the one-human key

    MockERC20 usdc;
    MockWorldID worldId;
    LoanRegistry registry;
    PassportRegistry passport;
    LoanVault vault;
    IncomeRouter router;
    TranchePool pool;

    address operator = address(0xBEEF); // owner + CRE forwarder stand-in
    address walletA = address(0xA11CE); // the human's first wallet
    address walletB = address(0xB0B); // a FRESH wallet — same human, after default

    string[5] STANDING = ["None", "Good", "Late", "Defaulted", "LockedOut"];

    function run() external {
        uint256[8] memory proof; // MockWorldID accepts any proof; the real ZK check is off-chain

        // ── Setup: deploy + wire as the operator, onboard the human, fund, write terms ─────────────
        vm.startPrank(operator);
        _deploy();
        passport.verifyAndMint(walletA, ROOT, NULLIFIER, proof);
        usdc.mint(operator, 5_000 * USDC);
        usdc.approve(address(vault), 5_000 * USDC);
        vault.fund(5_000 * USDC);
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

        // ── Act 1: the verified human borrows ──────────────────────────────────────────────────────
        vm.prank(walletA);
        vault.claim();
        _h("Act 1 - verified human borrows");
        console2.log("  walletA      ", walletA);
        console2.log("  standing     ", STANDING[_standing(walletA)]);
        console2.log("  borrowed USDC", usdc.balanceOf(walletA) / USDC);

        // ── Act 2: they never repay → after the term + grace, anyone can default them ──────────────
        vm.warp(block.timestamp + 30 days + 3 days + 1);
        vm.prank(operator);
        vault.markDefault(walletA);
        _h("Act 2 - missed the whole term -> DEFAULT");
        console2.log("  walletA standing now", STANDING[_standing(walletA)]); // LockedOut
        console2.log("  loss hit the junior tranche; the HUMAN is locked out network-wide");

        // ── Act 3: the respawn attempt — fresh wallet, same human, rejected on-chain ───────────────
        _h("Act 3 - respawn attempt with a BRAND-NEW wallet (same human)");
        console2.log("  walletB      ", walletB);
        vm.prank(operator);
        try passport.verifyAndMint(walletB, ROOT, NULLIFIER, proof) {
            console2.log("  !!! UNEXPECTED: fresh wallet minted a passport - anti-respawn FAILED");
        } catch {
            console2.log("  REJECTED on-chain (HumanLockedOut) - the defaulter cannot respawn.");
            console2.log("  walletB standing", STANDING[_standing(walletB)]); // None - never bound
        }

        _h("Result: personhood is the collateral - a new wallet can't escape a default.");
    }

    function _deploy() internal {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        worldId = new MockWorldID();
        registry = new LoanRegistry(operator); // operator is the forwarder + owner
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

    function _standing(address w) internal view returns (uint8) {
        return uint8(passport.standingOf(w));
    }

    function _h(string memory s) internal pure {
        console2.log("");
        console2.log(string.concat("== ", s, " =="));
    }
}
