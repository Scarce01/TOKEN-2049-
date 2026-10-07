// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Demo relay. The exchange submitter is a public Anvil key, so it cannot hold ETH.
/// EIP-7702 delegates that key to this contract. The deployer pays gas. RequestBoard
/// still sees the registered submitter as msg.sender.
contract DemoSubmit {
    function forward(address board, bytes calldata data) external {
        (bool ok, bytes memory ret) = board.call(data);
        if (ok) return;
        assembly {
            revert(add(ret, 0x20), mload(ret))
        }
    }
}
