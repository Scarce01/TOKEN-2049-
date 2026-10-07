// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Flow} from "./Flow.t.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// docs/47 3.3: the user drops their own queued withdrawal with their registered key.
contract UserCancelTest is Flow {
    function _delayed(uint256 amount, uint256 nonce, string memory tag)
        internal
        returns (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it, uint64 nb)
    {
        if (keys.keyOf(userId) == address(0)) registerKey(userId, userPk);
        if (deposits.depositedOf(userId, address(qUSD)) < 10_000e6) depositFor(userId, address(qUSD), 10_000e6);
        (rid, txh, it) = submitSigned(userId, userPk, address(qUSD), amount, nonce, tag);
        nb = uint64(nowTs() + 30 minutes);
        send(
            WF_COSIGN,
            one(
                Kinds.VERDICT,
                abi.encode(
                    rid,
                    txh,
                    it.userIdHash,
                    it.token,
                    it.amount,
                    Kinds.APPROVE,
                    uint8(0),
                    nb,
                    uint64(nowTs() + 2 hours),
                    new bytes(64)
                )
            )
        );
    }

    function _cancelSig(uint256 pk, bytes32 txh, uint64 dl) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, receiver.cancelDigest(txh, dl));
        return abi.encodePacked(r, s, v);
    }

    function test_userCancelsOwnDelayedApprove() public {
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it, uint64 nb) = _delayed(100e6, 1, "uc");
        uint256 before = receiver.approvedOf(userId, address(qUSD));
        uint64 dl = uint64(nowTs() + 10 minutes);
        bytes memory sig = _cancelSig(userPk, txh, dl);
        receiver.userCancelVerdict(txh, dl, sig); // anyone may relay it
        assertTrue(receiver.verdictOf(txh).released);
        assertEq(receiver.approvedOf(userId, address(qUSD)), before - 100e6);
        vm.warp(nb);
        vm.expectRevert(QuorumReceiver.NoVerdict.selector);
        hot.execute(vaultTx(rid, it));
    }

    function test_userCancelWrongKeyRejected() public {
        (, bytes32 txh,,) = _delayed(100e6, 1, "uc");
        uint64 dl = uint64(nowTs() + 10 minutes);
        bytes memory sig = _cancelSig(0xBAD, txh, dl);
        vm.expectRevert(QuorumReceiver.BadSig.selector);
        receiver.userCancelVerdict(txh, dl, sig);
    }

    function test_userCancelExpiredSignature() public {
        (, bytes32 txh,,) = _delayed(100e6, 1, "uc");
        uint64 dl = uint64(nowTs() - 1);
        bytes memory sig = _cancelSig(userPk, txh, dl);
        vm.expectRevert(QuorumReceiver.SigExpired.selector);
        receiver.userCancelVerdict(txh, dl, sig);
    }

    function test_userCancelOnlyUnusedApproveAndOnce() public {
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it, uint64 nb) = _delayed(100e6, 1, "uc");
        uint64 dl = uint64(nowTs() + 10 hours);
        bytes memory sig = _cancelSig(userPk, txh, dl);
        vm.warp(nb);
        hot.execute(vaultTx(rid, it)); // paid first
        vm.expectRevert(QuorumReceiver.NotHoldable.selector);
        receiver.userCancelVerdict(txh, dl, sig);
        // a cancelled one cannot be cancelled again: the signature is not replayable
        (, bytes32 txh2,,) = _delayed(50e6, 2, "uc2");
        bytes memory sig2 = _cancelSig(userPk, txh2, dl);
        receiver.userCancelVerdict(txh2, dl, sig2);
        vm.expectRevert(QuorumReceiver.NotHoldable.selector);
        receiver.userCancelVerdict(txh2, dl, sig2);
    }

    function test_userCancelSignatureBoundToOneWithdrawal() public {
        (, bytes32 txhA,,) = _delayed(100e6, 1, "a");
        uint64 dl = uint64(nowTs() + 10 minutes);
        bytes memory sigA = _cancelSig(userPk, txhA, dl);
        (, bytes32 txhB,,) = _delayed(100e6, 2, "b");
        vm.expectRevert(QuorumReceiver.BadSig.selector);
        receiver.userCancelVerdict(txhB, dl, sigA);
    }
}
