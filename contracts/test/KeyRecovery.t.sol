// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Flow} from "./Flow.t.sol";
import {KeyRegistry} from "../src/KeyRegistry.sol";

/// docs/47 3.7 (46 sections 5 and 6.3): co-signed rotation, long recovery that a second factor shortens or
/// cancels, second factor that waits once the account holds funds. Closes security audit High 3.
contract KeyRecoveryTest is Flow {
    uint256 constant NEW_PK = 0x7777;
    uint256 constant FACTOR_PK = 0x8888;
    address newKey;
    address factor;

    function setUp() public override {
        super.setUp();
        newKey = vm.addr(NEW_PK);
        factor = vm.addr(FACTOR_PK);
        registerKey(userId, userPk);
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _digest(address key, uint8 action, uint64 dl) internal view returns (bytes32) {
        return keys.keyBindingDigest(userId, key, action, keys.keyNonce(userId), dl);
    }

    function _addFactor() internal {
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 d = _digest(factor, 6, dl);
        keys.registerSecondFactor(userId, factor, dl, _sig(userPk, d), _sig(FACTOR_PK, d));
    }

    // ---------- rotation ----------
    function test_rotateNeedsCurrentAndNewKey() public {
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 d = _digest(newKey, 4, dl);
        bytes memory sNew = _sig(NEW_PK, d);
        vm.expectRevert(KeyRegistry.BadSig.selector);
        keys.rotateKey(userId, newKey, dl, sNew, sNew); // the new key alone is not enough
        d = _digest(newKey, 4, dl); // nonce moved on
        keys.rotateKey(userId, newKey, dl, _sig(userPk, d), _sig(NEW_PK, d));
        assertEq(keys.keyOf(userId), newKey); // immediate
    }

    // ---------- recovery without a factor: long delay, cancellable ----------
    function test_recoveryAloneWaitsRecoveryDelay() public {
        uint64 dl = uint64(nowTs() + 1 hours);
        keys.requestKeyChange(userId, newKey, dl, _sig(NEW_PK, _digest(newKey, 2, dl)));
        vm.warp(nowTs() + keys.keyChangeDelay());
        vm.expectRevert(KeyRegistry.NotReady.selector);
        keys.finalizeKeyChange(userId); // High 3: the short delay no longer hands the account over
        vm.warp(nowTs() + keys.recoveryDelay());
        keys.finalizeKeyChange(userId);
        assertEq(keys.keyOf(userId), newKey);
    }

    function test_approveRecoveryNeedsARegisteredFactor() public {
        uint64 dl = uint64(nowTs() + 1 hours);
        keys.requestKeyChange(userId, newKey, dl, _sig(NEW_PK, _digest(newKey, 2, dl)));
        bytes memory s = _sig(FACTOR_PK, _digest(newKey, 5, dl));
        vm.expectRevert(KeyRegistry.NoFactor.selector);
        keys.approveRecovery(userId, dl, s);
    }

    // ---------- recovery with a factor: short delay, or cancelled by the factor ----------
    function test_factorShortensRecovery() public {
        _addFactor(); // no deposits yet: immediate
        assertEq(keys.secondFactorOf(userId), factor);
        uint64 dl = uint64(nowTs() + 1 hours);
        keys.requestKeyChange(userId, newKey, dl, _sig(NEW_PK, _digest(newKey, 2, dl)));
        bytes memory wrong = _sig(NEW_PK, _digest(newKey, 5, dl));
        vm.expectRevert(KeyRegistry.BadSig.selector);
        keys.approveRecovery(userId, dl, wrong);
        keys.approveRecovery(userId, dl, _sig(FACTOR_PK, _digest(newKey, 5, dl)));
        vm.warp(nowTs() + keys.keyChangeDelay());
        keys.finalizeKeyChange(userId);
        assertEq(keys.keyOf(userId), newKey);
    }

    function test_factorOrCurrentKeyCancelsRecovery() public {
        _addFactor();
        uint64 dl = uint64(nowTs() + 1 hours);
        keys.requestKeyChange(userId, newKey, dl, _sig(NEW_PK, _digest(newKey, 2, dl)));
        keys.cancelKeyChange(userId, dl, _sig(FACTOR_PK, _digest(newKey, 3, dl)));
        (address pk,) = keys.pendingOf(userId);
        assertEq(pk, address(0));
        keys.requestKeyChange(userId, newKey, dl, _sig(NEW_PK, _digest(newKey, 2, dl)));
        bytes memory stranger = _sig(0xBAD, _digest(newKey, 3, dl));
        vm.expectRevert(KeyRegistry.BadSig.selector);
        keys.cancelKeyChange(userId, dl, stranger);
        keys.cancelKeyChange(userId, dl, _sig(userPk, _digest(newKey, 3, dl)));
    }

    // ---------- adding a factor once funds exist waits, and the key can cancel it ----------
    function test_factorAfterDepositWaitsAndKeyCanCancel() public {
        depositFor(userId, address(qUSD), 100e6);
        _addFactor();
        assertEq(keys.secondFactorOf(userId), address(0));
        vm.expectRevert(KeyRegistry.NotReady.selector);
        keys.finalizeSecondFactor(userId);
        uint64 dl = uint64(nowTs() + 1 hours);
        keys.cancelSecondFactor(userId, dl, _sig(userPk, _digest(factor, 7, dl)));
        (address pf,) = keys.pendingFactor(userId);
        assertEq(pf, address(0));
        _addFactor();
        vm.warp(nowTs() + keys.keyChangeDelay());
        keys.finalizeSecondFactor(userId);
        assertEq(keys.secondFactorOf(userId), factor);
    }

    function test_factorNeedsBothSignaturesAndOnlyOne() public {
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 d = _digest(factor, 6, dl);
        bytes memory sk = _sig(userPk, d);
        vm.expectRevert(KeyRegistry.BadSig.selector);
        keys.registerSecondFactor(userId, factor, dl, sk, sk); // factor did not sign
        _addFactor();
        uint64 dl2 = uint64(nowTs() + 1 hours);
        bytes32 d2 = _digest(vm.addr(0xCAFE), 6, dl2);
        bytes memory sk2 = _sig(userPk, d2);
        bytes memory sf2 = _sig(0xCAFE, d2);
        vm.expectRevert(KeyRegistry.FactorExists.selector);
        keys.registerSecondFactor(userId, vm.addr(0xCAFE), dl2, sk2, sf2);
    }
}
