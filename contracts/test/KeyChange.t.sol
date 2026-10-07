// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Flow} from "./Flow.t.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// docs/47 3.6 (46 section 6.3, minimal key epoch): once the user's key changes, a queued approval signed by
/// the old key is not paid; and the first payment to a recipient is timestamped.
contract KeyChangeTest is Flow {
    uint256 constant NEW_PK = 0x9999;

    function _delayedApprove() internal returns (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it, uint64 nb) {
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 1_000e6);
        (rid, txh, it) = submitSigned(userId, userPk, address(qUSD), 100e6, 1, "kc");
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
                    uint64(nowTs() + 3 hours),
                    new bytes(64)
                )
            )
        );
    }

    function _changeKey(uint256 newPk) internal {
        address newKey = vm.addr(newPk);
        uint64 dl = uint64(nowTs() + 1 hours);
        // co-signed rotation (3.7): immediate, so the queued approval is still unexpired when it is refused
        bytes32 digest = keys.keyBindingDigest(userId, newKey, 4, keys.keyNonce(userId), dl);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(userPk, digest);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(newPk, digest);
        keys.rotateKey(userId, newKey, dl, abi.encodePacked(r1, s1, v1), abi.encodePacked(r2, s2, v2));
        assertEq(keys.keyOf(userId), newKey);
    }

    function test_keyChangeBlocksQueuedApprove() public {
        (bytes32 rid,, RequestBoard.Intent memory it, uint64 nb) = _delayedApprove();
        _changeKey(NEW_PK);
        if (nowTs() < nb) vm.warp(nb);
        vm.expectRevert(QuorumReceiver.KeyChanged.selector);
        hot.execute(vaultTx(rid, it));
    }

    function test_withoutKeyChangeQueuedApprovePays() public {
        (bytes32 rid,, RequestBoard.Intent memory it, uint64 nb) = _delayedApprove();
        vm.warp(nb);
        hot.execute(vaultTx(rid, it));
        assertEq(qUSD.balanceOf(payee), 100e6);
    }

    function test_firstPaymentTimestampsRecipient() public {
        (bytes32 rid,, RequestBoard.Intent memory it, uint64 nb) = _delayedApprove();
        assertEq(receiver.seenAt(userId, payee), 0);
        assertFalse(receiver.seenRecipient(userId, payee));
        vm.warp(nb);
        hot.execute(vaultTx(rid, it));
        assertEq(receiver.seenAt(userId, payee), uint64(nowTs()));
        assertTrue(receiver.seenRecipient(userId, payee));
        // a later payment keeps the first timestamp
        uint64 first = receiver.seenAt(userId, payee);
        vm.warp(nowTs() + 1 days);
        (bytes32 rid2,, RequestBoard.Intent memory it2) = approvedWithdrawal(10e6, 2, "again");
        hot.execute(vaultTx(rid2, it2));
        assertEq(receiver.seenAt(userId, payee), first);
    }
}
