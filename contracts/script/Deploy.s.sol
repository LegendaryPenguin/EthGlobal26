// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {IncomeRouter} from "../src/IncomeRouter.sol";
import {PassportRegistry} from "../src/PassportRegistry.sol";
import {TranchePool} from "../src/TranchePool.sol";
import {IWorldID} from "../src/interfaces/IWorldID.sol";

/// @notice Stage 1–4 deploy on Arc Testnet (chain id 5042002, Golden Rule #3).
/// @dev    Run:
///         forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast \
///           --private-key $DEPLOYER_PRIVATE_KEY
///
///         USDC_ADDRESS and WORLD_ID_VERIFIER_ADDRESS must come from the Circle MCP / Arc contract
///         pages and the World docs respectively — NEVER hardcode them here (Golden Rule #5).
contract Deploy is Script {
    function run() external {
        // The CRE Forwarder may not exist yet; deploy with a placeholder and rotate later via
        // LoanRegistry.setForwarder(...) once the workflow is deployed/simulated (docs/04).
        address forwarder = vm.envOr("CRE_FORWARDER_ADDRESS", msg.sender);
        address usdc = vm.envAddress("USDC_ADDRESS"); // from Circle MCP / Arc contract pages
        address worldIdVerifier = vm.envAddress("WORLD_ID_VERIFIER_ADDRESS"); // from World docs
        string memory appId = vm.envString("WORLD_APP_ID");
        string memory actionId = vm.envString("WORLD_ACTION_ID");

        require(block.chainid == 5042002, "not Arc Testnet (5042002)"); // Golden Rule #3

        vm.startBroadcast();

        LoanRegistry registry = new LoanRegistry(forwarder);
        PassportRegistry passport = new PassportRegistry(IWorldID(worldIdVerifier), appId, actionId);

        // Deploy the vault with router unset, then wire the router (circular reference) + the gate.
        LoanVault vault = new LoanVault(address(registry), usdc, address(0));
        IncomeRouter router = new IncomeRouter(address(vault), usdc);

        // Stage 6/8 lender side: senior/junior tranche pool, senior targeting 6% APY (600 bps).
        TranchePool pool = new TranchePool(usdc, 600);

        vault.setRouter(address(router));
        vault.setPassportRegistry(address(passport)); // Stage 4 anti-respawn gate ON

        // Stage 8 wiring: the vault is the reputation oracle (drives standing from repayment outcomes)
        // and the pool's loss reporter (reports default capital losses); the vault reports those losses
        // to the pool. All three are optional gates, set here for a production deploy.
        passport.setReputationOracle(address(vault));
        pool.setLossReporter(address(vault));
        vault.setTranchePool(address(pool));

        vm.stopBroadcast();

        console2.log("LoanRegistry:    ", address(registry));
        console2.log("PassportRegistry:", address(passport));
        console2.log("LoanVault:       ", address(vault));
        console2.log("IncomeRouter:    ", address(router));
        console2.log("TranchePool:     ", address(pool));
        console2.log("Forwarder:       ", forwarder);
        console2.log("USDC:            ", usdc);
        console2.log("WorldID verifier:", worldIdVerifier);
    }
}
