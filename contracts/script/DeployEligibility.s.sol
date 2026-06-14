// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console2} from "forge-std/Script.sol";
import {HonkVerifier} from "../src/HonkVerifier.sol";
import {EligibilityGate} from "../src/EligibilityGate.sol";

/// @notice Deploys the Track-D on-chain ZK gate to Arc Testnet (chain id 5042002):
///         the bb-generated UltraHonk `HonkVerifier` + the `EligibilityGate` that re-binds policy
///         (threshold + default-list root) and guards nullifier reuse around it.
///
/// @dev    Fund the deployer with testnet USDC (Arc pays gas in USDC) at https://faucet.circle.com,
///         then:
///           forge script script/DeployEligibility.s.sol:DeployEligibility \
///             --rpc-url $ARC_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast --slow
///
///         Policy defaults match circuits/src/main.nr + app/src/zk/eligibility.ts:
///           threshold        = 3000
///           defaultListRoot  = 0x00f9952fe025cd3ad8ff1346fb409cdb22c9e7d5eb266d74d2e1b156a5d438ba
///         Override via env ELIGIBILITY_THRESHOLD (uint) / ELIGIBILITY_DEFAULT_ROOT (bytes32).
contract DeployEligibility is Script {
    function run() external {
        require(block.chainid == 5042002, "not Arc Testnet (5042002)"); // Golden Rule #3

        uint256 thresholdInt = vm.envOr("ELIGIBILITY_THRESHOLD", uint256(3000));
        bytes32 defaultRoot = vm.envOr(
            "ELIGIBILITY_DEFAULT_ROOT",
            bytes32(0x00f9952fe025cd3ad8ff1346fb409cdb22c9e7d5eb266d74d2e1b156a5d438ba)
        );
        bytes32 threshold = bytes32(thresholdInt);

        vm.startBroadcast();
        HonkVerifier verifier = new HonkVerifier();
        EligibilityGate gate = new EligibilityGate(address(verifier), threshold, defaultRoot);
        vm.stopBroadcast();

        console2.log("== Arc Testnet - ZK eligibility gate ==");
        console2.log("HonkVerifier:   ", address(verifier));
        console2.log("EligibilityGate:", address(gate));
        console2.log("threshold:      ", thresholdInt);
        console2.logBytes32(defaultRoot);
    }
}
