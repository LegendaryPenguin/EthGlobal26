// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {IncomeRouter} from "../src/IncomeRouter.sol";

/// @notice Stage 1/2 deploy on Arc Testnet (chain id 5042002, Golden Rule #3).
/// @dev    Run:
///         forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast \
///           --private-key $DEPLOYER_PRIVATE_KEY
///
///         USDC_ADDRESS must come from the Circle MCP server / contract-address page for Arc —
///         NEVER hardcode it here (Golden Rule #5). Set it in .env once looked up.
contract Deploy is Script {
    function run() external {
        // The CRE Forwarder may not exist yet; deploy with a placeholder and rotate later via
        // LoanRegistry.setForwarder(...) once the workflow is deployed/simulated (docs/04).
        address forwarder = vm.envOr("CRE_FORWARDER_ADDRESS", msg.sender);
        address usdc = vm.envAddress("USDC_ADDRESS"); // from Circle MCP / Arc contract pages

        require(block.chainid == 5042002, "not Arc Testnet (5042002)"); // Golden Rule #3

        vm.startBroadcast();

        LoanRegistry registry = new LoanRegistry(forwarder);
        // Deploy the vault with router unset, then wire the router (circular reference).
        LoanVault vault = new LoanVault(address(registry), usdc, address(0));
        IncomeRouter router = new IncomeRouter(address(vault), usdc);
        vault.setRouter(address(router));

        vm.stopBroadcast();

        console2.log("LoanRegistry:", address(registry));
        console2.log("LoanVault:   ", address(vault));
        console2.log("IncomeRouter:", address(router));
        console2.log("Forwarder:   ", forwarder);
        console2.log("USDC:        ", usdc);
    }
}
