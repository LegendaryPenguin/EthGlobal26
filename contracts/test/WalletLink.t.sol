// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WalletLink} from "../src/WalletLink.sol";

contract WalletLinkTest is Test {
    WalletLink wl;
    address wallet = makeAddr("wallet");
    bytes32 worldA = keccak256("humanA");
    bytes32 worldB = keccak256("humanB");
    address rando = address(0xBEEF);

    function setUp() public { wl = new WalletLink(); }

    function test_linkAndRead() public {
        wl.link(wallet, worldA);
        assertEq(wl.worldIdOf(wallet), worldA);
        assertEq(wl.walletOf(worldA), wallet);
        assertTrue(wl.isLinked(wallet));
    }

    function test_sameLinkIsIdempotent() public {
        wl.link(wallet, worldA);
        wl.link(wallet, worldA); // no revert
        assertEq(wl.worldIdOf(wallet), worldA);
    }

    function test_walletCannotJoinSecondWorldId() public {
        wl.link(wallet, worldA);
        vm.expectRevert(abi.encodeWithSelector(WalletLink.WalletAlreadyLinked.selector, worldA));
        wl.link(wallet, worldB); // the demo: can't attach this wallet to a new World ID
    }

    function test_worldIdCannotTakeSecondWallet() public {
        wl.link(wallet, worldA);
        vm.expectRevert(abi.encodeWithSelector(WalletLink.WorldIdAlreadyLinked.selector, wallet));
        wl.link(makeAddr("wallet2"), worldA);
    }

    function test_onlyLinkerCanLink() public {
        vm.prank(rando);
        vm.expectRevert(WalletLink.NotLinker.selector);
        wl.link(wallet, worldA);
    }

    function test_zeroValuesRevert() public {
        vm.expectRevert(WalletLink.ZeroValue.selector);
        wl.link(address(0), worldA);
        vm.expectRevert(WalletLink.ZeroValue.selector);
        wl.link(wallet, bytes32(0));
    }
}
