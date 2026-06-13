// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILoanRegistry} from "./interfaces/ILoanRegistry.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title LoanVault (Arc) — the money layer. STUB for Stage 2 (Advanced Stablecoin Logic track).
/// @notice Holds pooled USDC; on a borrower's claim, checks `getTerms` + a valid attestation,
///         then disburses. Tracks per-loan balance + amortization. See docs/02 + docs/06 Stage 2.
/// @dev    USDC is 6 decimals (Golden Rule #4). USDC address must be injected, never hardcoded
///         (Golden Rule #5) — pass it from a deploy script that reads the Circle MCP/address page.
contract LoanVault {
    ILoanRegistry public immutable registry;
    IERC20 public immutable usdc;

    struct Loan {
        uint256 principal;     // disbursed amount, 6 decimals
        uint256 outstanding;   // remaining owed (principal + accrued interest), 6 decimals
        uint16  aprBps;
        uint64  startedAt;
        bool    disbursed;
    }

    mapping(address borrower => Loan) public loans;

    event Disbursed(address indexed borrower, uint256 amount, bytes32 attestationRef);

    error NotApproved();
    error TermsExpired();
    error AlreadyDisbursed();
    error MissingAttestation();

    constructor(address _registry, address _usdc) {
        registry = ILoanRegistry(_registry);
        usdc = IERC20(_usdc);
    }

    /// @notice Borrower claims an approved loan. Reads the seam, validates, disburses USDC.
    /// @dev    STAGE 2 TODO:
    ///         - verify `attestationRef` against the Chainlink attestation (Confidential AI track)
    ///         - build the amortization schedule (programmable repayment)
    ///         - integrate the World ID / passport good-standing check before disbursing
    function claim() external {
        ILoanRegistry.Terms memory t = registry.getTerms(msg.sender);

        if (!t.approved) revert NotApproved();
        if (t.expiry != 0 && block.timestamp > t.expiry) revert TermsExpired();
        if (t.attestationRef == bytes32(0)) revert MissingAttestation();
        if (loans[msg.sender].disbursed) revert AlreadyDisbursed();

        loans[msg.sender] = Loan({
            principal: t.principal,
            outstanding: t.principal, // + interest once amortization schedule is added
            aprBps: t.aprBps,
            startedAt: uint64(block.timestamp),
            disbursed: true
        });

        emit Disbursed(msg.sender, t.principal, t.attestationRef);

        // STAGE 2 TODO: replace with safe-transfer + balance checks once funded.
        require(usdc.transfer(msg.sender, t.principal), "USDC transfer failed");
    }
}
