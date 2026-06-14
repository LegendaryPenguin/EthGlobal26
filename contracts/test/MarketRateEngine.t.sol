// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MarketRateEngine} from "../src/MarketRateEngine.sol";

contract MarketRateEngineTest is Test {
    MarketRateEngine eng;
    address admin = address(0xA11CE);
    address rando = address(0xBEEF);

    function setUp() public {
        eng = new MarketRateEngine(300); // 3% base rate
        eng.setMarketAdmin(admin);
    }

    function test_initialState() public view {
        assertEq(eng.baseRateBps(), 300);
        assertEq(eng.utilizationBps(), 0); // no supply yet
    }

    function test_utilizationComputed() public {
        vm.prank(admin);
        eng.setPool(1_000_000_000, 500_000_000); // 1000 supplied, 500 borrowed → 50%
        assertEq(eng.utilizationBps(), 5000);
    }

    function test_higherUtilizationRaisesBorrowApr() public {
        vm.startPrank(admin);
        eng.pushAndPoke(300, 50, 50, 1_000_000_000, 200_000_000); // 20% util, balanced
        uint16 lowApr = eng.currentBorrowAprBps();
        eng.pushAndPoke(300, 50, 50, 1_000_000_000, 950_000_000); // 95% util (past kink), balanced
        uint16 highApr = eng.currentBorrowAprBps();
        vm.stopPrank();
        assertGt(highApr, lowApr); // scarcity → steeper rate past the kink
    }

    function test_moreBorrowersThanLendersRaisesApr() public {
        vm.startPrank(admin);
        eng.pushAndPoke(300, 90, 10, 1_000_000_000, 500_000_000); // supply-heavy → cheaper
        uint16 supplyHeavy = eng.currentBorrowAprBps();
        eng.pushAndPoke(300, 10, 90, 1_000_000_000, 500_000_000); // demand-heavy → pricier
        uint16 demandHeavy = eng.currentBorrowAprBps();
        vm.stopPrank();
        assertGt(demandHeavy, supplyHeavy);
    }

    function test_supplyYieldTracksUtilizationAndReserve() public {
        vm.prank(admin);
        eng.pushAndPoke(300, 50, 50, 1_000_000_000, 800_000_000); // 80% util
        (uint16 borrowApr, uint16 supplyYield,,) = eng.previewRates();
        // yield = apr × util × (1 − reserve). With util 80% and reserve 10%, yield < borrowApr.
        assertGt(borrowApr, 0);
        assertGt(supplyYield, 0);
        assertLt(supplyYield, borrowApr);
    }

    function test_pokePersistsAndIsPermissionless() public {
        vm.prank(admin);
        eng.setPool(1_000_000_000, 700_000_000);
        vm.prank(rando); // anyone can poke
        eng.poke();
        assertGt(eng.currentBorrowAprBps(), 0);
        assertEq(eng.lastPokeAt(), block.timestamp);
    }

    function test_riskBandAddOnsOrdered() public {
        vm.prank(admin);
        eng.pushAndPoke(300, 50, 50, 1_000_000_000, 500_000_000);
        uint16 a = eng.borrowAprForBand(0);
        uint16 b = eng.borrowAprForBand(1);
        uint16 d = eng.borrowAprForBand(3);
        assertLt(a, b);
        assertLt(b, d);
    }

    function test_aprCappedAtMax() public {
        vm.startPrank(admin);
        eng.pushAndPoke(50000, 1, 1000, 1_000_000_000, 1_000_000_000); // extreme everything
        vm.stopPrank();
        assertLe(eng.currentBorrowAprBps(), eng.maxAprBps());
    }

    function test_onlyAdminCanPush() public {
        vm.prank(rando);
        vm.expectRevert(MarketRateEngine.NotAdmin.selector);
        eng.setMarket(300, 10, 10);
    }

    function test_onlyOwnerCanSetParams() public {
        vm.prank(rando);
        vm.expectRevert(MarketRateEngine.NotOwner.selector);
        eng.setParams(8000, 400, 6000, 1500, 1000, 5000);
    }
}
