// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {HonkVerifier} from "../src/HonkVerifier.sol";
import {EligibilityGate} from "../src/EligibilityGate.sol";

/// @notice End-to-end test of the Track-D on-chain ZK gate: feeds a REAL UltraHonk proof (generated
///         by scripts/zk-gen-evmproof.mjs from the compiled circuit) to the bb-generated HonkVerifier
///         and the EligibilityGate. Proves the on-chain verification path actually accepts a valid
///         eligibility proof and enforces policy re-bind + nullifier replay protection.
contract EligibilityGateTest is Test {
    // Policy (matches circuits/src/main.nr witness + app/src/zk/eligibility.ts).
    bytes32 constant THRESHOLD = bytes32(uint256(3000));
    bytes32 constant DEFAULT_LIST_ROOT =
        0x00f9952fe025cd3ad8ff1346fb409cdb22c9e7d5eb266d74d2e1b156a5d438ba;

    HonkVerifier verifier;
    EligibilityGate gate;
    bytes proof;
    bytes32[] publicInputs;

    function setUp() public {
        string memory json = vm.readFile("test/fixtures/eligibility_proof.json");
        proof = vm.parseJsonBytes(json, ".proof");
        publicInputs = vm.parseJsonBytes32Array(json, ".publicInputs");

        verifier = new HonkVerifier();
        gate = new EligibilityGate(address(verifier), THRESHOLD, DEFAULT_LIST_ROOT);
    }

    /// The raw verifier accepts the real proof.
    function test_HonkVerifier_acceptsRealProof() public view {
        assertTrue(verifier.verify(proof, publicInputs), "verifier should accept valid proof");
    }

    /// The proof's public inputs are in the expected [threshold, root, commitment, nullifier] order.
    function test_PublicInputs_orderAndPolicy() public view {
        assertEq(publicInputs.length, 4, "4 public inputs");
        assertEq(publicInputs[0], THRESHOLD, "slot0 = threshold");
        assertEq(publicInputs[1], DEFAULT_LIST_ROOT, "slot1 = default-list root");
    }

    /// The gate records eligibility for the borrower and burns the nullifier.
    function test_Gate_passesAndRecords() public {
        address borrower = address(0xB0B);
        assertFalse(gate.isEligible(borrower));
        bytes32 nullifier = gate.proveEligibility(borrower, proof, publicInputs);
        assertTrue(gate.isEligible(borrower), "borrower eligible after proof");
        assertTrue(gate.nullifierUsed(nullifier), "nullifier burned");
        assertEq(nullifier, publicInputs[3], "nullifier = slot3");
    }

    /// A second pass with the same nullifier is rejected (replay guard).
    function test_Gate_rejectsReplay() public {
        gate.proveEligibility(address(0xB0B), proof, publicInputs);
        vm.expectRevert(EligibilityGate.NullifierAlreadyUsed.selector);
        gate.proveEligibility(address(0xCAFE), proof, publicInputs);
    }

    /// A gate whose policy threshold differs rejects the proof (policy re-bind).
    function test_Gate_rejectsStaleThreshold() public {
        EligibilityGate strict =
            new EligibilityGate(address(verifier), bytes32(uint256(9999)), DEFAULT_LIST_ROOT);
        vm.expectRevert(EligibilityGate.StaleThreshold.selector);
        strict.proveEligibility(address(0xB0B), proof, publicInputs);
    }
}
