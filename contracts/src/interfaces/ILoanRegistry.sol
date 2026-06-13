// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILoanRegistry — the seam between the decision layer and the money layer.
/// @notice FROZEN INTERFACE (Golden Rule #1). The Chainlink CRE workflow WRITES `setTerms`
///         (through the CRE Forwarder); the Arc `LoanVault` READS `getTerms`. Both halves
///         build against this and only this. Do not change the `Terms` layout without a
///         coordinated re-freeze across /cre and /contracts.
///
/// @dev    PRIVACY INVARIANT (Golden Rule #2): nothing here may reveal a borrower's actual
///         income. Only the attested verdict lands on-chain — `attestationRef` is a hash/ref
///         of the Chainlink confidential attestation, never the underlying financial data.
interface ILoanRegistry {
    /// @notice The single source of truth for an approved loan's terms.
    struct Terms {
        address borrower;       // wallet that receives funds
        bytes32 passportId;     // ERC-8004 identity-bound id (one per human)
        uint256 principal;      // USDC, 6 decimals (Golden Rule #4 — do not mix with 18-dec gas)
        uint16  aprBps;         // e.g. 1000 = 10.00%
        uint8   riskBand;       // 0 = A .. n
        bytes32 attestationRef; // ref/hash of the Chainlink confidential attestation
        uint64  expiry;         // terms valid until (unix seconds)
        bool    approved;       // false until the workflow lands an approved verdict
    }

    event TermsSet(
        address indexed borrower,
        bytes32 indexed passportId,
        uint256 principal,
        uint16 aprBps,
        uint8 riskBand,
        bytes32 attestationRef,
        uint64 expiry,
        bool approved
    );

    event ForwarderUpdated(address indexed previousForwarder, address indexed newForwarder);

    /// @notice Write an attested verdict. Callable only by the trusted CRE Forwarder.
    function setTerms(Terms calldata t) external;

    /// @notice Read the current terms for a borrower. Returns a zeroed struct if none exist.
    function getTerms(address borrower) external view returns (Terms memory);

    /// @notice The CRE Forwarder authorized to write verdicts.
    function forwarder() external view returns (address);
}
