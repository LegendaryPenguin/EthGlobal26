// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RateModel} from "../src/RateModel.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {MockAggregator} from "./MockAggregator.sol";

/// @notice Connect-the-World bonus: a Chainlink feed read that causes an on-chain state change.
contract RateModelTest is Test {
    MockAggregator feed;
    RateModel model;

    address admin = address(this);
    address borrower = makeAddr("borrower");
    address stranger = makeAddr("stranger");

    int256 constant BASELINE = 1e8; // 8-decimal feed, baseline 1.00000000

    function setUp() public {
        // Warp to a realistic clock so staleness subtraction can't underflow (default ts = 1).
        vm.warp(1_700_000_000);
        // updatedAt = now so it's fresh.
        feed = new MockAggregator(8, BASELINE, block.timestamp);
        model = new RateModel(IAggregatorV3(address(feed)), BASELINE);
    }

    function test_finalizeAtBaselineAddsNoSpread() public {
        uint16 eff = model.finalizeRate(borrower, 1000); // base 10%
        assertEq(eff, 1000);
        assertEq(model.effectiveAprBps(borrower), 1000); // on-chain state written
    }

    function test_deviationAddsSpread() public {
        // Feed 10% away from baseline → +1000 bps spread.
        feed.setAnswer((BASELINE * 110) / 100);
        feed.setUpdatedAt(block.timestamp);
        uint16 eff = model.finalizeRate(borrower, 1000);
        assertEq(model.spreadBps(), 1000);
        assertEq(eff, 2000); // 1000 base + 1000 spread
        assertEq(model.effectiveAprBps(borrower), 2000);
    }

    function test_spreadCappedAndAprCapped() public {
        // Feed 99% below baseline → deviation 9900 bps, capped to MAX_SPREAD_BPS (1500).
        feed.setAnswer(BASELINE / 100);
        feed.setUpdatedAt(block.timestamp);
        assertEq(model.spreadBps(), model.MAX_SPREAD_BPS());

        // base near the cap → effective clamps at MAX_APR_BPS.
        uint16 eff = model.finalizeRate(borrower, 4900);
        assertEq(eff, model.MAX_APR_BPS()); // 4900 + 1500 -> capped 5000
    }

    function test_stalePriceReverts() public {
        feed.setUpdatedAt(block.timestamp - 2 hours); // older than maxStaleness (1h)
        vm.expectRevert(RateModel.StalePrice.selector);
        model.finalizeRate(borrower, 1000);
    }

    function test_invalidPriceReverts() public {
        feed.setAnswer(0);
        feed.setUpdatedAt(block.timestamp);
        vm.expectRevert(RateModel.InvalidPrice.selector);
        model.finalizeRate(borrower, 1000);
    }

    function test_onlyOwnerOrAdminCanFinalize() public {
        vm.prank(stranger);
        vm.expectRevert(RateModel.NotAuthorized.selector);
        model.finalizeRate(borrower, 1000);

        // After granting admin, the address can finalize.
        model.setRateAdmin(stranger);
        vm.prank(stranger);
        model.finalizeRate(borrower, 1000);
        assertEq(model.effectiveAprBps(borrower), 1000);
    }
}
