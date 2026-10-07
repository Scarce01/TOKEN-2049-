// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Stand-in for an ETH/USD feed if Base Sepolia has none (S6). Test-only.
contract MockV3Aggregator {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        _set(answer_, block.timestamp);
    }

    function updateAnswer(int256 answer_) external {
        _set(answer_, block.timestamp);
    }

    /// Lets scenes make the price stale (gate 6).
    function updateRoundData(int256 answer_, uint256 updatedAt_) external {
        _set(answer_, updatedAt_);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }

    function _set(int256 a, uint256 t) private {
        answer = a;
        updatedAt = t;
        ++roundId;
    }
}
