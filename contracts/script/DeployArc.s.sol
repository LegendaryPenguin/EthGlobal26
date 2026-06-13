// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {IncomeRouter} from "../src/IncomeRouter.sol";
import {PassportRegistry} from "../src/PassportRegistry.sol";
import {TranchePool} from "../src/TranchePool.sol";
import {IWorldID} from "../src/interfaces/IWorldID.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {MockWorldID} from "../test/MockWorldID.sol";

/// @notice Live Arc Testnet deploy (chain id 5042002). Uses REAL Arc USDC (from USDC_ADDRESS) but a
///         MockWorldID for the on-chain verifier — World ID's Router is NOT deployed on Arc (docs/05),
///         so the real ZK validation happens off-chain via World's v4 cloud verify (Path A) and the
///         relayer mints. The forwarder is set to the deployer so terms can be seeded via setTerms.
/// @dev    forge script script/DeployArc.s.sol:DeployArc --rpc-url $ARC_RPC_URL \
///           --private-key $DEPLOYER_PRIVATE_KEY --broadcast --slow
///         Requires USDC_ADDRESS in env (Golden Rule #5 — never hardcode).
contract DeployArc is Script {
    function run() external {
        require(block.chainid == 5042002, "not Arc Testnet (5042002)"); // Golden Rule #3

        address usdc = vm.envAddress("USDC_ADDRESS"); // real Arc USDC (6 decimals)
        string memory appId = vm.envOr("WORLD_APP_ID", string("app_vouch_arc"));
        string memory actionId = vm.envOr("WORLD_ACTION_ID", string("mint-credit-passport"));
        // Forwarder = the borrower server's relayer (only writer of setTerms); defaults to deployer.
        address forwarder = vm.envOr("REGISTRY_FORWARDER", msg.sender);
        // Pool seeding (default 0 → skip; deploy-arc.sh sets these so loans are funded by the pool).
        uint256 seedSenior = vm.envOr("SEED_SENIOR_USDC", uint256(0));
        uint256 seedJunior = vm.envOr("SEED_JUNIOR_USDC", uint256(0));
        uint256 toVault = vm.envOr("DEPLOY_TO_VAULT_USDC", uint256(0));

        vm.startBroadcast();

        MockWorldID worldId = new MockWorldID(); // on-chain no-op; real check is the v4 cloud verify
        LoanRegistry registry = new LoanRegistry(forwarder);
        PassportRegistry passport = new PassportRegistry(IWorldID(address(worldId)), appId, actionId);
        LoanVault vault = new LoanVault(address(registry), usdc, address(0));
        IncomeRouter router = new IncomeRouter(address(vault), usdc);
        TranchePool pool = new TranchePool(usdc, 600);

        vault.setRouter(address(router));
        vault.setPassportRegistry(address(passport));
        passport.setReputationOracle(address(vault));
        pool.setLossReporter(address(vault));
        vault.setTranchePool(address(pool));

        // Seed the pool from the deployer's USDC, then deploy that capital into the vault so borrower
        // loans are drawn from lender pool capital. Deployer must hold USDC (faucet.circle.com).
        if (seedSenior + seedJunior > 0) {
            IERC20(usdc).approve(address(pool), seedSenior + seedJunior);
            if (seedSenior > 0) pool.deposit(TranchePool.Tranche.Senior, seedSenior);
            if (seedJunior > 0) pool.deposit(TranchePool.Tranche.Junior, seedJunior);
        }
        if (toVault > 0) pool.deployToVault(address(vault), toVault);

        vm.stopBroadcast();

        console2.log("== Arc Testnet deploy ==");
        console2.log("MockWorldID:     ", address(worldId));
        console2.log("LoanRegistry:    ", address(registry));
        console2.log("PassportRegistry:", address(passport));
        console2.log("LoanVault:       ", address(vault));
        console2.log("IncomeRouter:    ", address(router));
        console2.log("TranchePool:     ", address(pool));
        console2.log("USDC:            ", usdc);
    }
}
