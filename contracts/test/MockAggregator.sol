// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";

/// @notice Test double for a Chainlink AggregatorV3 price feed. Configurable answer + updatedAt so
///         tests can exercise deviation spread and staleness.
contract MockAggregator is IAggregatorV3 {
    uint8 public decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId = 1;

    constructor(uint8 _decimals, int256 _answer, uint256 _updatedAt) {
        decimals = _decimals;
        answer = _answer;
        updatedAt = _updatedAt;
    }

    function setAnswer(int256 _answer) external {
        answer = _answer;
    }

    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }

    function description() external pure returns (string memory) {
        return "Mock Feed";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}
