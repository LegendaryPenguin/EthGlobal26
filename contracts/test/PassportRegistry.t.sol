// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PassportRegistry} from "../src/PassportRegistry.sol";
import {IWorldID} from "../src/interfaces/IWorldID.sol";
import {MockWorldID} from "./MockWorldID.sol";

contract PassportRegistryTest is Test {
    PassportRegistry registry;
    MockWorldID worldId;

    address tunde = makeAddr("tunde");
    address tundeNewWallet = makeAddr("tundeNewWallet");

    // One human = one nullifier hash (scoped to our action).
    uint256 constant NULLIFIER = uint256(keccak256("tunde-human"));
    uint256 constant ROOT = 123456;
    uint256[8] proof; // mock verifier ignores contents

    function setUp() public {
        worldId = new MockWorldID();
        registry = new PassportRegistry(IWorldID(address(worldId)), "app_vouch", "mint-credit-passport");
    }

    function test_firstVerifyMintsPassportInGoodStanding() public {
        registry.verifyAndMint(tunde, ROOT, NULLIFIER, proof);

        assertTrue(registry.isInGoodStanding(tunde));
        assertEq(uint8(registry.standingOf(tunde)), uint8(PassportRegistry.Standing.Good));
        assertEq(registry.limitOf(tunde), registry.INITIAL_LIMIT());
        assertEq(registry.passportIdOf(tunde), bytes32(NULLIFIER));
        assertEq(registry.walletToHuman(tunde), NULLIFIER);
    }

    function test_invalidProofReverts() public {
        worldId.setShouldRevert(true);
        vm.expectRevert("MockWorldID: invalid proof");
        registry.verifyAndMint(tunde, ROOT, NULLIFIER, proof);
    }

    function test_secondWalletSameHumanMapsToSamePassport() public {
        registry.verifyAndMint(tunde, ROOT, NULLIFIER, proof);
        // Same human (same nullifier), different wallet — re-verify binds the new wallet.
        registry.verifyAndMint(tundeNewWallet, ROOT, NULLIFIER, proof);

        // Both wallets resolve to the same human/passport — no second passport minted.
        assertEq(registry.walletToHuman(tunde), NULLIFIER);
        assertEq(registry.walletToHuman(tundeNewWallet), NULLIFIER);
        assertEq(registry.passportIdOf(tundeNewWallet), bytes32(NULLIFIER));
    }

    function test_lockedOutHumanCannotRebindNewWallet() public {
        registry.verifyAndMint(tunde, ROOT, NULLIFIER, proof);

        // Owner flags the human locked out (walked away from a loan).
        registry.setStanding(NULLIFIER, PassportRegistry.Standing.LockedOut, 0, 0);

        // The respawn attempt: a fresh wallet, same human → rejected.
        vm.expectRevert(PassportRegistry.HumanLockedOut.selector);
        registry.verifyAndMint(tundeNewWallet, ROOT, NULLIFIER, proof);
    }

    function test_lateStandingStillAllowedToBorrow() public {
        registry.verifyAndMint(tunde, ROOT, NULLIFIER, proof);
        registry.setStanding(NULLIFIER, PassportRegistry.Standing.Late, 10, registry.INITIAL_LIMIT());
        assertTrue(registry.isInGoodStanding(tunde));
    }

    function test_defaultedStandingBlocksBorrow() public {
        registry.verifyAndMint(tunde, ROOT, NULLIFIER, proof);
        registry.setStanding(NULLIFIER, PassportRegistry.Standing.Defaulted, 0, 0);
        assertFalse(registry.isInGoodStanding(tunde));
    }

    function test_unknownWalletNotInGoodStanding() public view {
        assertFalse(registry.isInGoodStanding(tunde));
        assertEq(uint8(registry.standingOf(tunde)), uint8(PassportRegistry.Standing.None));
    }

    function test_setStandingOnlyAuthority() public {
        registry.verifyAndMint(tunde, ROOT, NULLIFIER, proof);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(PassportRegistry.NotAuthorized.selector);
        registry.setStanding(NULLIFIER, PassportRegistry.Standing.Defaulted, 0, 0);
    }
}
