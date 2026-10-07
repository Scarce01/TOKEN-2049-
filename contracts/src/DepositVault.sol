// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// Records user deposits on-chain (the chain fact gate 5 relies on) and forwards funds to the
/// exchange's collector address (fixed at construction; not a vault). 10_interfaces.md 3.6.
contract DepositVault {
    using SafeERC20 for IERC20;

    error LengthMismatch();
    error ZeroAmount();
    error UnknownToken();

    event Deposited(bytes32 indexed userIdHash, address indexed token, address indexed from, uint256 amount);

    address public immutable collector;
    mapping(address => uint256) public minDeposit; // token => MIN_DEPOSIT; 0 = not accepted
    mapping(bytes32 => mapping(address => uint256)) public depositedOf;
    mapping(bytes32 => uint64) public firstDepositAt;
    mapping(bytes32 => bool) public hasDeposit;

    constructor(address collector_, address[] memory tokens, uint256[] memory minDeposits) {
        if (tokens.length != minDeposits.length) revert LengthMismatch();
        collector = collector_;
        for (uint256 i; i < tokens.length; ++i) minDeposit[tokens[i]] = minDeposits[i];
    }

    function deposit(bytes32 userIdHash, address token, uint256 amount) external {
        _record(userIdHash, token, amount);
        IERC20(token).safeTransferFrom(msg.sender, collector, amount);
    }

    /// Seed helper: one token, many users, pulled from msg.sender in one transfer.
    function depositBatch(bytes32[] calldata userIdHashes, address token, uint256[] calldata amounts) external {
        if (userIdHashes.length != amounts.length) revert LengthMismatch();
        uint256 total;
        for (uint256 i; i < userIdHashes.length; ++i) {
            _record(userIdHashes[i], token, amounts[i]);
            total += amounts[i];
        }
        IERC20(token).safeTransferFrom(msg.sender, collector, total);
    }

    function _record(bytes32 userIdHash, address token, uint256 amount) private {
        uint256 min = minDeposit[token];
        if (min == 0) revert UnknownToken();
        if (amount == 0) revert ZeroAmount();
        uint256 total = depositedOf[userIdHash][token] + amount;
        depositedOf[userIdHash][token] = total;
        if (firstDepositAt[userIdHash] == 0) firstDepositAt[userIdHash] = uint64(block.timestamp);
        if (total >= min) hasDeposit[userIdHash] = true;
        emit Deposited(userIdHash, token, msg.sender, amount);
    }
}
