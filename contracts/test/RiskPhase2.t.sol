// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Flow} from "./Flow.t.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {OfficerAuth} from "../src/lib/OfficerAuth.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// docs/47 phase 2: contract floor for large withdrawals to new addresses (R2), per-withdrawal HOLD and
/// cancel, hourly and daily outflow windows.
contract RiskPhase2Test is Flow {
    function _largeNew(uint256 min) internal {
        vm.prank(address(timelock));
        receiver.setLargeNewMin(address(qUSD), min);
    }

    function _approved(uint256 amount, uint256 nonce, string memory tag, uint64 notBefore)
        internal
        returns (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it)
    {
        if (keys.keyOf(userId) == address(0)) registerKey(userId, userPk);
        if (deposits.depositedOf(userId, address(qUSD)) < 10_000e6) depositFor(userId, address(qUSD), 10_000e6);
        (rid, txh, it) = submitSigned(userId, userPk, address(qUSD), amount, nonce, tag);
        uint64 exp = uint64(nowTs() + VERDICT_TTL);
        send(
            WF_COSIGN,
            one(
                Kinds.VERDICT,
                abi.encode(
                    rid, txh, it.userIdHash, it.token, it.amount, Kinds.APPROVE, uint8(0), notBefore, exp, new bytes(64)
                )
            )
        );
    }

    // ---------- RequestBoard keeps the signed recipient ----------
    function test_recipientRecorded() public {
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 1_000e6);
        (bytes32 rid,,) = submitSigned(userId, userPk, address(qUSD), 10e6, 1, "r");
        assertEq(board.recipientOf(rid), payee);
    }

    // ---------- R2 contract floor ----------
    function test_largeNewFloorDelaysEvenIfCreSaysNow() public {
        _largeNew(1_000e6);
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = _approved(2_000e6, 1, "big", 0);
        QuorumReceiver.Verdict memory v = receiver.verdictOf(txh);
        assertEq(v.notBefore, nowTs() + LARGE_NEW_DELAY);
        assertGe(v.expiresAt, v.notBefore + VERDICT_TTL);
        vm.expectRevert(QuorumVault.NotYetValid.selector);
        hot.execute(vaultTx(rid, it));
        vm.warp(v.notBefore);
        hot.execute(vaultTx(rid, it));
        assertEq(qUSD.balanceOf(payee), 2_000e6);
    }

    function test_largeNewNoFloorForKnownRecipient() public {
        _largeNew(1_000e6);
        (bytes32 rid1,, RequestBoard.Intent memory it1) = _approved(100e6, 1, "small", 0);
        hot.execute(vaultTx(rid1, it1)); // payee is now a known recipient
        (bytes32 rid2, bytes32 txh2, RequestBoard.Intent memory it2) = _approved(2_000e6, 2, "big", 0);
        assertEq(receiver.verdictOf(txh2).notBefore, 0);
        hot.execute(vaultTx(rid2, it2));
    }

    function test_largeNewKeepsLongerCreDelay() public {
        _largeNew(1_000e6);
        uint64 creNb = uint64(nowTs() + 3 * LARGE_NEW_DELAY);
        (, bytes32 txh,) = _approved(2_000e6, 1, "big", creNb);
        assertEq(receiver.verdictOf(txh).notBefore, creNb);
    }

    function test_largeNewOffWhenZero() public {
        (, bytes32 txh,) = _approved(2_000e6, 1, "big", 0);
        assertEq(receiver.verdictOf(txh).notBefore, 0);
    }

    function test_setLargeNewMinOnlyTimelock() public {
        vm.expectRevert(QuorumReceiver.NotTimelock.selector);
        receiver.setLargeNewMin(address(qUSD), 1);
    }

    // ---------- per-withdrawal HOLD (one officer, expires) ----------
    function test_oneOfficerHoldsUntilExpiry() public {
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = _approved(100e6, 1, "h", 0);
        uint64 until = uint64(nowTs() + 1 hours);
        bytes[] memory s = officerSigs(address(desk), Kinds.OA_HOLD_VERDICT, txh, until, 1, until, single(0));
        desk.holdVerdict(txh, until, 1, until, s);
        vm.expectRevert(QuorumReceiver.Held.selector);
        hot.execute(vaultTx(rid, it));
        vm.warp(until);
        hot.execute(vaultTx(rid, it)); // the hold expired and kept the verdict alive past its own TTL
        assertEq(qUSD.balanceOf(payee), 100e6);
    }

    function test_holdCappedAtHoldMax() public {
        (, bytes32 txh,) = _approved(100e6, 1, "h", 0);
        uint64 until = uint64(nowTs() + HOLD_MAX + 1);
        bytes[] memory s = officerSigs(address(desk), Kinds.OA_HOLD_VERDICT, txh, until, 1, until, single(0));
        vm.expectRevert(QuorumReceiver.BadHold.selector);
        desk.holdVerdict(txh, until, 1, until, s);
    }

    function test_holdCooldownStopsRelocking() public {
        (, bytes32 txh,) = _approved(100e6, 1, "h", 0);
        uint64 until = uint64(nowTs() + 1 hours);
        bytes[] memory s = officerSigs(address(desk), Kinds.OA_HOLD_VERDICT, txh, until, 1, until, single(0));
        desk.holdVerdict(txh, until, 1, until, s);
        vm.warp(until);
        uint64 again = uint64(nowTs() + 1 hours);
        bytes[] memory s2 = officerSigs(address(desk), Kinds.OA_HOLD_VERDICT, txh, again, 2, again, single(1));
        vm.expectRevert(QuorumReceiver.HoldCooldown.selector);
        desk.holdVerdict(txh, again, 2, again, s2);
    }

    function test_holdOnlyUnusedApprove() public {
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = _approved(100e6, 1, "h", 0);
        hot.execute(vaultTx(rid, it));
        uint64 until = uint64(nowTs() + 1 hours);
        bytes[] memory s = officerSigs(address(desk), Kinds.OA_HOLD_VERDICT, txh, until, 1, until, single(0));
        vm.expectRevert(QuorumReceiver.NotHoldable.selector);
        desk.holdVerdict(txh, until, 1, until, s);
    }

    // ---------- cancel (two officers) ----------
    function test_cancelNeedsTwoOfficers() public {
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = _approved(100e6, 1, "c", 0);
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes[] memory one_ = officerSigs(address(desk), Kinds.OA_CANCEL_VERDICT, txh, 0, 1, dl, single(0));
        vm.expectRevert(OfficerAuth.NotEnoughOfficers.selector);
        desk.cancelVerdict(txh, 1, dl, one_);
        uint256 approvedBefore = receiver.approvedOf(userId, address(qUSD));
        bytes[] memory s = officerSigs(address(desk), Kinds.OA_CANCEL_VERDICT, txh, 0, 2, dl, two());
        desk.cancelVerdict(txh, 2, dl, s);
        assertEq(receiver.approvedOf(userId, address(qUSD)), approvedBefore - 100e6);
        vm.expectRevert(QuorumReceiver.NoVerdict.selector);
        hot.execute(vaultTx(rid, it));
    }

    // ---------- hourly and daily windows ----------
    function test_hourWindowCapsOutflow() public {
        vm.prank(address(timelock));
        hot.setWindowCaps(address(qUSD), 1_500e6, 0);
        vm.warp((nowTs() / 1 hours + 1) * 1 hours - 60); // a minute before the hour ends, so the verdicts stay valid
        (bytes32 r1,, RequestBoard.Intent memory i1) = _approved(800e6, 1, "w1", 0);
        hot.execute(vaultTx(r1, i1));
        (bytes32 r2,, RequestBoard.Intent memory i2) = _approved(800e6, 2, "w2", 0);
        vm.expectRevert(QuorumVault.WindowExceeded.selector);
        hot.execute(vaultTx(r2, i2));
        vm.warp((nowTs() / 1 hours + 1) * 1 hours); // next hour
        hot.execute(vaultTx(r2, i2));
    }

    function test_dayWindowCapsOutflow() public {
        vm.prank(address(timelock));
        hot.setWindowCaps(address(qUSD), 0, 1_000e6);
        (bytes32 r1,, RequestBoard.Intent memory i1) = _approved(800e6, 1, "d1", 0);
        hot.execute(vaultTx(r1, i1));
        (bytes32 r2,, RequestBoard.Intent memory i2) = _approved(300e6, 2, "d2", 0);
        vm.expectRevert(QuorumVault.WindowExceeded.selector);
        hot.execute(vaultTx(r2, i2));
    }

    function test_setWindowCapsOnlyTimelock() public {
        vm.expectRevert(QuorumVault.NotTimelock.selector);
        hot.setWindowCaps(address(qUSD), 1, 1);
    }
}
