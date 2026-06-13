// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title RateModel — Connect-the-World bonus (docs/04). A Chainlink price/FX feed read that causes
///        an ON-CHAIN state change: when finalizing a loan's APR we read the feed and persist an
///        effective rate. (Reading a feed only in the frontend does NOT count for the bonus.)
/// @notice The feed is a benchmark / FX rate (e.g. for localized EURC loans). The further the rate
///         deviates from a baseline, the more spread we add to the base APR — bounded and persisted.
/// @dev    Feed address pulled from Chainlink docs / Arc-supported feeds — never hardcoded
///         (Golden Rule #5). All APR figures are bps (1000 = 10.00%).
contract RateModel {
    IAggregatorV3 public immutable feed;
    address public owner;

    /// @dev Address allowed to finalize rates (e.g. the CRE Forwarder when it writes terms, or the
    ///      LoanVault). Owner-rotatable. Prevents arbitrary callers from setting a borrower's rate.
    address public rateAdmin;

    /// @notice The feed reading we treat as "neutral". Deviation from this adds spread. Settable.
    int256 public baselineAnswer;
    /// @notice Max age of a feed answer before we reject it as stale (seconds).
    uint256 public maxStaleness = 1 hours;

    uint16 public constant MAX_SPREAD_BPS = 1500; // up to +15.00% from feed deviation
    uint16 public constant MAX_APR_BPS = 5000; // hard cap 50.00%
    uint256 internal constant BPS = 10_000;

    /// @notice On-chain state set from the feed: the finalized APR for each borrower.
    mapping(address borrower => uint16 aprBps) public effectiveAprBps;

    event RateFinalized(address indexed borrower, uint16 baseAprBps, uint16 spreadBps, uint16 effectiveAprBps, int256 feedAnswer);
    event BaselineUpdated(int256 baseline);

    error NotOwner();
    error NotAuthorized();
    error InvalidPrice();
    error StalePrice();
    error ZeroBaseline();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IAggregatorV3 _feed, int256 _baselineAnswer) {
        if (_baselineAnswer <= 0) revert ZeroBaseline();
        feed = _feed;
        baselineAnswer = _baselineAnswer;
        owner = msg.sender;
        rateAdmin = msg.sender;
    }

    function setRateAdmin(address _admin) external onlyOwner {
        rateAdmin = _admin;
    }

    function setBaseline(int256 _baseline) external onlyOwner {
        if (_baseline <= 0) revert ZeroBaseline();
        baselineAnswer = _baseline;
        emit BaselineUpdated(_baseline);
    }

    function setMaxStaleness(uint256 _seconds) external onlyOwner {
        maxStaleness = _seconds;
    }

    /// @notice Read the Chainlink feed and persist the borrower's effective APR. This is the bonus's
    ///         required on-chain state change. Callable by owner or rateAdmin.
    /// @return effective The finalized APR in bps (base + feed-derived spread, capped).
    function finalizeRate(address borrower, uint16 baseAprBps) external returns (uint16 effective) {
        if (msg.sender != owner && msg.sender != rateAdmin) revert NotAuthorized();

        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > maxStaleness) revert StalePrice();

        uint16 spread = _spreadBps(answer);
        uint256 sum = uint256(baseAprBps) + spread;
        effective = sum > MAX_APR_BPS ? MAX_APR_BPS : uint16(sum);

        effectiveAprBps[borrower] = effective; // ← on-chain state change driven by the feed
        emit RateFinalized(borrower, baseAprBps, spread, effective, answer);
    }

    /// @notice Spread in bps from how far the feed deviates from baseline: |answer-baseline|/baseline,
    ///         capped at MAX_SPREAD_BPS. A pure view so the frontend can preview without a state change.
    function spreadBps() external view returns (uint16) {
        (, int256 answer,,,) = feed.latestRoundData();
        if (answer <= 0) return 0;
        return _spreadBps(answer);
    }

    function _spreadBps(int256 answer) internal view returns (uint16) {
        int256 base = baselineAnswer;
        int256 diff = answer > base ? answer - base : base - answer;
        uint256 deviationBps = (uint256(diff) * BPS) / uint256(base);
        return deviationBps > MAX_SPREAD_BPS ? MAX_SPREAD_BPS : uint16(deviationBps);
    }
}
