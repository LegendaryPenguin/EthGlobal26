// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MarketRateEngine} from "../src/MarketRateEngine.sol";

/// @notice Deploy the MarketRateEngine to Arc. The deployer becomes owner + marketAdmin, so the
///         off-chain market simulator (running with the same key) can push conditions and poke.
///         Usage:
///           forge script script/DeployRateEngine.s.sol:DeployRateEngine \
///             --rpc-url $ARC_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast --slow
contract DeployRateEngine is Script {
    function run() external {
        uint16 baseRateBps = uint16(vm.envOr("BASE_RATE_BPS", uint256(300))); // 3% default
        vm.startBroadcast();
        MarketRateEngine engine = new MarketRateEngine(baseRateBps);
        // Seed an initial realistic snapshot so the contract reads non-zero before the sim's first push.
        engine.pushAndPoke(baseRateBps, 40, 55, 60_000_000, 18_000_000); // ~30% util, demand-leaning
        vm.stopBroadcast();
        console2.log("MarketRateEngine:", address(engine));
        console2.log("borrowAprBps:", engine.currentBorrowAprBps());
        console2.log("supplyYieldBps:", engine.currentSupplyYieldBps());
    }
}
