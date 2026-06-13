// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILoanRegistry} from "./interfaces/ILoanRegistry.sol";

/// @title LoanRegistry — the on-chain seam (build first, freeze first).
/// @notice The CRE Forwarder is the ONLY address allowed to write terms. The Arc LoanVault
///         (and anyone) may read them. This decoupling is what lets the decision layer and the
///         money layer be built in parallel — see docs/02-architecture.md.
contract LoanRegistry is ILoanRegistry {
    /// @dev Owner may rotate the Forwarder (e.g. after deploying the CRE workflow). Kept minimal
    ///      on purpose — no OpenZeppelin dependency needed for the seam.
    address public owner;

    /// @inheritdoc ILoanRegistry
    address public forwarder;

    mapping(address borrower => Terms) private _terms;

    error NotOwner();
    error NotForwarder();
    error ZeroForwarder();
    error BorrowerMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert NotForwarder();
        _;
    }

    /// @param _forwarder The CRE Forwarder address. May be set to a placeholder and rotated later
    ///                   via {setForwarder} once the workflow is deployed/simulated.
    constructor(address _forwarder) {
        owner = msg.sender;
        forwarder = _forwarder; // allowed to be address(0) at deploy; gate writes until rotated
        emit ForwarderUpdated(address(0), _forwarder);
    }

    /// @notice Rotate the trusted Forwarder. Owner-only.
    function setForwarder(address _forwarder) external onlyOwner {
        if (_forwarder == address(0)) revert ZeroForwarder();
        emit ForwarderUpdated(forwarder, _forwarder);
        forwarder = _forwarder;
    }

    /// @notice Transfer ownership (e.g. to a multisig). Owner-only.
    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
    }

    /// @inheritdoc ILoanRegistry
    function setTerms(Terms calldata t) external onlyForwarder {
        // The verdict is keyed by borrower; guard against a malformed report.
        if (t.borrower == address(0)) revert BorrowerMismatch();
        _terms[t.borrower] = t;
        emit TermsSet(
            t.borrower,
            t.passportId,
            t.principal,
            t.aprBps,
            t.riskBand,
            t.attestationRef,
            t.expiry,
            t.approved
        );
    }

    /// @inheritdoc ILoanRegistry
    function getTerms(address borrower) external view returns (Terms memory) {
        return _terms[borrower];
    }
}
