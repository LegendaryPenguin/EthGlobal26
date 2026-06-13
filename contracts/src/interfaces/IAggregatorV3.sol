// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Chainlink AggregatorV3 price-feed interface. Pull the feed address from the
///         Chainlink docs / Arc-supported feeds — never hardcode (Golden Rule #5). Used by
///         {RateModel} to read a benchmark/FX rate ON-CHAIN (Connect-the-World bonus, docs/04).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
