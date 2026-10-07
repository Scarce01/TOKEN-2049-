// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// Deploys qUSD and qETH and is their only minter. Each address has an hourly cap; seed
/// addresses (fixed at construction) get a separate, larger hourly cap.
contract Faucet {
    error OverHourlyCap();
    error UnknownToken();

    event Dripped(address indexed token, address indexed to, uint256 amount);

    MockERC20 public immutable qUSD;
    MockERC20 public immutable qETH;

    uint256 public immutable capUSD;
    uint256 public immutable capETH;
    uint256 public immutable seedCapUSD;
    uint256 public immutable seedCapETH;

    mapping(address => bool) public isSeeder;
    // keccak(token, account, hour) => minted this hour
    mapping(bytes32 => uint256) public mintedInHour;

    constructor(address[] memory seeders, uint256 capUSD_, uint256 capETH_, uint256 seedCapUSD_, uint256 seedCapETH_) {
        qUSD = new MockERC20("Quorum Test USD", "qUSD", 6);
        qETH = new MockERC20("Quorum Test ETH", "qETH", 18);
        capUSD = capUSD_;
        capETH = capETH_;
        seedCapUSD = seedCapUSD_;
        seedCapETH = seedCapETH_;
        for (uint256 i; i < seeders.length; ++i) isSeeder[seeders[i]] = true;
    }

    function drip(address token, address to, uint256 amount) external {
        uint256 cap;
        if (token == address(qUSD)) cap = isSeeder[msg.sender] ? seedCapUSD : capUSD;
        else if (token == address(qETH)) cap = isSeeder[msg.sender] ? seedCapETH : capETH;
        else revert UnknownToken();
        bytes32 k = keccak256(abi.encode(token, msg.sender, block.timestamp / 3600));
        uint256 used = mintedInHour[k] + amount;
        if (used > cap) revert OverHourlyCap();
        mintedInHour[k] = used;
        MockERC20(token).mint(to, amount);
        emit Dripped(token, to, amount);
    }
}
