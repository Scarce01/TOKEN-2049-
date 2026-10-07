// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// User-side helpers: key registration, deposit, signed request, verdict.
abstract contract Flow is Base {
    uint256 userPk = 0xD00D;
    address userKey;
    bytes32 userId = keccak256(abi.encode(bytes32("orgSaltA"), "user-1"));
    address payee = makeAddr("payee");

    function setUp() public virtual override {
        super.setUp();
        userKey = vm.addr(userPk);
    }

    function registerKey(bytes32 uid, uint256 pk) internal {
        address k = vm.addr(pk);
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 d = keys.keyBindingDigest(uid, k, 1, keys.keyNonce(uid), dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        keys.register(uid, k, dl, abi.encodePacked(r, s, v));
    }

    function depositFor(bytes32 uid, address token, uint256 amount) internal {
        faucet.drip(token, address(this), amount);
        if (token == address(qUSD)) qUSD.approve(address(deposits), amount);
        else qETH.approve(address(deposits), amount);
        deposits.deposit(uid, token, amount);
    }

    function intentOf(bytes32 uid, address token, address to, uint256 amount, uint256 nonce)
        internal
        view
        returns (RequestBoard.Intent memory)
    {
        return RequestBoard.Intent(ORG_A, uid, address(hot), token, to, amount, nonce, uint64(nowTs() + 1 hours));
    }

    function vaultTx(bytes32 requestId, RequestBoard.Intent memory it) internal pure returns (QuorumVault.VaultTx memory) {
        return QuorumVault.VaultTx(requestId, it.userIdHash, it.token, it.to, it.amount, it.nonce, it.deadline);
    }

    function txHashFor(address vault, bytes32 requestId, RequestBoard.Intent memory it) internal view returns (bytes32) {
        return keccak256(
            abi.encode(block.chainid, vault, requestId, it.userIdHash, it.token, it.to, it.amount, it.nonce, it.deadline)
        );
    }

    function signIntent(RequestBoard.Intent memory it, uint256 pk) internal view returns (bytes memory) {
        bytes32 d = board.intentDigest(it);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function requestOf(bytes32 requestId, RequestBoard.Intent memory it, bytes32 txHash)
        internal
        pure
        returns (RequestBoard.Request memory)
    {
        return RequestBoard.Request(
            requestId,
            it.orgId,
            it.userIdHash,
            0,
            it.vault,
            it.token,
            it.to,
            it.amount,
            it.nonce,
            it.deadline,
            txHash,
            RequestBoard.SafeTx(address(0), 0, "", 0)
        );
    }

    /// Submits a correctly signed request; returns (requestId, txHash, intent).
    function submitSigned(bytes32 uid, uint256 pk, address token, uint256 amount, uint256 nonce, string memory tag)
        internal
        returns (bytes32 requestId, bytes32 txHash, RequestBoard.Intent memory it)
    {
        it = intentOf(uid, token, payee, amount, nonce);
        requestId = keccak256(abi.encode(ORG_A, keccak256(bytes(tag))));
        txHash = txHashFor(address(hot), requestId, it);
        bytes memory sig = signIntent(it, pk);
        vm.prank(submitterA);
        board.submit(requestOf(requestId, it, txHash), it, sig);
    }

    function verdictAction(bytes32 requestId, bytes32 txHash, RequestBoard.Intent memory it, uint8 decision)
        internal
        view
        returns (QuorumReceiver.Action[] memory)
    {
        uint64 exp = decision == Kinds.APPROVE ? uint64(nowTs() + VERDICT_TTL) : 0;
        return one(
            Kinds.VERDICT,
            abi.encode(
                requestId,
                txHash,
                it.userIdHash,
                it.token,
                it.amount,
                decision,
                uint8(0),
                uint64(0),
                exp,
                new bytes(64)
            )
        );
    }

    /// Registered key + deposit + signed request + APPROVE verdict.
    function approvedWithdrawal(uint256 amount, uint256 nonce, string memory tag)
        internal
        returns (bytes32 requestId, bytes32 txHash, RequestBoard.Intent memory it)
    {
        if (keys.keyOf(userId) == address(0)) registerKey(userId, userPk);
        if (deposits.depositedOf(userId, address(qUSD)) < 10_000e6) depositFor(userId, address(qUSD), 10_000e6);
        (requestId, txHash, it) = submitSigned(userId, userPk, address(qUSD), amount, nonce, tag);
        send(WF_COSIGN, verdictAction(requestId, txHash, it, Kinds.APPROVE));
    }
}
