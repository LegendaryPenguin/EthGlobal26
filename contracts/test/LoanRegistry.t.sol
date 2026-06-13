// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";
import {ILoanRegistry} from "../src/interfaces/ILoanRegistry.sol";

/// @notice Stage 1 milestone: terms can be written (only by the Forwarder) and read back on-chain.
contract LoanRegistryTest is Test {
    LoanRegistry registry;

    address owner = address(this);
    address forwarder = makeAddr("forwarder");
    address borrower = makeAddr("borrower");
    address attacker = makeAddr("attacker");

    function setUp() public {
        registry = new LoanRegistry(forwarder);
    }

    function _approvedTerms() internal view returns (ILoanRegistry.Terms memory) {
        return ILoanRegistry.Terms({
            borrower: borrower,
            passportId: keccak256("passport-1"),
            principal: 500_000_000, // $500 USDC at 6 decimals — NOT 500e18 (Golden Rule #4)
            aprBps: 1000, // 10.00%
            riskBand: 1,
            attestationRef: keccak256("attestation-1"),
            expiry: uint64(block.timestamp + 1 days),
            approved: true
        });
    }

    function test_forwarderCanWriteAndAnyoneCanRead() public {
        vm.prank(forwarder);
        registry.setTerms(_approvedTerms());

        ILoanRegistry.Terms memory got = registry.getTerms(borrower);
        assertEq(got.borrower, borrower);
        assertEq(got.principal, 500_000_000);
        assertEq(got.aprBps, 1000);
        assertTrue(got.approved);
        assertEq(got.attestationRef, keccak256("attestation-1"));
    }

    function test_nonForwarderCannotWrite() public {
        vm.prank(attacker);
        vm.expectRevert(LoanRegistry.NotForwarder.selector);
        registry.setTerms(_approvedTerms());
    }

    function test_ownerCanRotateForwarder() public {
        address newForwarder = makeAddr("newForwarder");
        registry.setForwarder(newForwarder);
        assertEq(registry.forwarder(), newForwarder);

        vm.prank(newForwarder);
        registry.setTerms(_approvedTerms());
        assertTrue(registry.getTerms(borrower).approved);
    }

    function test_nonOwnerCannotRotateForwarder() public {
        vm.prank(attacker);
        vm.expectRevert(LoanRegistry.NotOwner.selector);
        registry.setForwarder(attacker);
    }

    function test_rejectsZeroBorrower() public {
        ILoanRegistry.Terms memory t = _approvedTerms();
        t.borrower = address(0);
        vm.prank(forwarder);
        vm.expectRevert(LoanRegistry.BorrowerMismatch.selector);
        registry.setTerms(t);
    }
}
