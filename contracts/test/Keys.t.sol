// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Flow} from "./Flow.t.sol";
import {KeyRegistry} from "../src/KeyRegistry.sol";
import {DepositVault} from "../src/DepositVault.sol";
import {Kinds} from "../src/lib/Kinds.sol";

contract KeysTest is Flow {
    function _bindSig(bytes32 uid, address k, uint8 action, uint256 pk, uint64 dl)
        internal
        view
        returns (bytes memory)
    {
        bytes32 d = keys.keyBindingDigest(uid, k, action, keys.keyNonce(uid), dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function test_registerImmediateWithoutDeposit() public {
        registerKey(userId, userPk);
        assertEq(keys.keyOf(userId), userKey);
    }

    function test_registerQueuedWithDeposit() public {
        depositFor(userId, address(qUSD), 100e6);
        registerKey(userId, userPk);
        assertEq(keys.keyOf(userId), address(0));
        vm.expectRevert(KeyRegistry.NotReady.selector);
        keys.finalizeKeyChange(userId);
        vm.warp(nowTs() + KEY_DELAY);
        keys.finalizeKeyChange(userId);
        assertEq(keys.keyOf(userId), userKey);
    }

    function test_griefDepositBelowMinDoesNotQueue() public {
        depositFor(userId, address(qUSD), 1); // 1 micro-qUSD < MIN_DEPOSIT
        assertFalse(deposits.hasDeposit(userId));
        registerKey(userId, userPk);
        assertEq(keys.keyOf(userId), userKey);
    }

    function test_officerCancelsQueuedRegistration() public {
        depositFor(userId, address(qUSD), 100e6);
        uint256 attackerPk = 0xBAD;
        registerKey(userId, attackerPk);
        (address pk, uint64 readyAt) = keys.pendingOf(userId);
        bytes32 qid = keys.queueIdOf(userId, pk, readyAt);
        uint64 dl = uint64(nowTs() + 1 hours);
        keys.officerCancel(userId, 1, dl, officerSigs(address(keys), Kinds.OA_CANCEL_QUEUED, qid, 0, 1, dl, single(2)));
        vm.warp(nowTs() + KEY_DELAY);
        vm.expectRevert(KeyRegistry.NoPending.selector);
        keys.finalizeKeyChange(userId);
        assertEq(keys.keyOf(userId), address(0));
    }

    function test_keyChangeAndCancelByOldKey() public {
        registerKey(userId, userPk);
        uint256 newPk = 0xBEEF;
        address newKey = vm.addr(newPk);
        uint64 dl = uint64(nowTs() + 1 hours);
        keys.requestKeyChange(userId, newKey, dl, _bindSig(userId, newKey, 2, newPk, dl));
        keys.cancelKeyChange(userId, dl, _bindSig(userId, newKey, 3, userPk, dl));
        vm.warp(nowTs() + KEY_DELAY);
        vm.expectRevert(KeyRegistry.NoPending.selector);
        keys.finalizeKeyChange(userId);

        keys.requestKeyChange(userId, newKey, dl, _bindSig(userId, newKey, 2, newPk, dl));
        vm.warp(nowTs() + RECOVERY_DELAY); // docs/47 3.7: recovery with the new key alone waits the long delay
        keys.finalizeKeyChange(userId);
        assertEq(keys.keyOf(userId), newKey);
    }

    function test_registerRejectsWrongSigner() public {
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes memory sig = _bindSig(userId, userKey, 1, 0xBAD, dl);
        vm.expectRevert(KeyRegistry.BadSig.selector);
        keys.register(userId, userKey, dl, sig);
    }

    function test_depositFirstAtAndCollector() public {
        depositFor(userId, address(qUSD), 50e6);
        assertEq(deposits.firstDepositAt(userId), nowTs());
        assertEq(deposits.depositedOf(userId, address(qUSD)), 50e6);
        assertEq(qUSD.balanceOf(collector), 50e6);
        vm.warp(nowTs() + 1 days);
        depositFor(userId, address(qUSD), 1e6);
        assertEq(deposits.firstDepositAt(userId), nowTs() - 1 days);
    }
}
