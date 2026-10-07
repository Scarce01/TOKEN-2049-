// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {Flow} from "./Flow.t.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {OfficerDesk} from "../src/OfficerDesk.sol";
import {ColdVault} from "../src/ColdVault.sol";
import {Kinds} from "../src/lib/Kinds.sol";

contract VerdictTest is Flow {
    function test_verdictWrittenOnce() public {
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = approvedWithdrawal(100e6, 1, "w1");
        vm.recordLogs();
        send(WF_COSIGN, verdictAction(rid, txh, it, Kinds.REJECT));
        assertEq(receiver.verdictOf(txh).decision, Kinds.APPROVE);
        assertTrue(_emitted(QuorumReceiver.VerdictDuplicate.selector));
        assertEq(receiver.approvedOf(userId, address(qUSD)), 100e6);
    }

    function test_approveUsableOnce() public {
        (bytes32 rid,, RequestBoard.Intent memory it) = approvedWithdrawal(100e6, 1, "w1");
        hot.execute(vaultTx(rid, it));
        vm.expectRevert(QuorumVault.AlreadyPaid.selector);
        hot.execute(vaultTx(rid, it));
    }

    function test_expiredApproveUnusable() public {
        (bytes32 rid,, RequestBoard.Intent memory it) = approvedWithdrawal(100e6, 1, "w1");
        vm.warp(nowTs() + VERDICT_TTL + 1);
        vm.expectRevert(QuorumReceiver.NoVerdict.selector);
        hot.execute(vaultTx(rid, it));
    }

    function test_pendingAndRejectUnusable() public {
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 1_000e6);
        (bytes32 r1, bytes32 t1, RequestBoard.Intent memory i1) = submitSigned(userId, userPk, address(qUSD), 1e6, 1, "p");
        send(WF_COSIGN, verdictAction(r1, t1, i1, Kinds.PENDING));
        vm.expectRevert(QuorumReceiver.NoVerdict.selector);
        hot.execute(vaultTx(r1, i1));
        (bytes32 r2, bytes32 t2, RequestBoard.Intent memory i2) = submitSigned(userId, userPk, address(qUSD), 1e6, 2, "r");
        send(WF_COSIGN, verdictAction(r2, t2, i2, Kinds.REJECT));
        vm.expectRevert(QuorumReceiver.NoVerdict.selector);
        hot.execute(vaultTx(r2, i2));
        assertEq(receiver.approvedOf(userId, address(qUSD)), 0);
        assertEq(receiver.verdictOf(t1).expiresAt, 0);
    }

    function test_orphanedVerdictIgnored() public {
        RequestBoard.Intent memory it = intentOf(userId, address(qUSD), payee, 1e6, 1);
        vm.recordLogs();
        send(WF_COSIGN, verdictAction(keccak256("never-submitted"), keccak256("txh"), it, Kinds.APPROVE));
        assertTrue(_emitted(QuorumReceiver.VerdictOrphaned.selector));
        assertEq(receiver.verdictOf(keccak256("txh")).decision, Kinds.NONE);
    }

    /// D63: APPROVE where the board signer is not the registered key is stored as PENDING 31.
    function test_signerNotKeyDowngraded() public {
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 1_000e6);
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) =
            submitSigned(userId, 0xBAD, address(qUSD), 1e6, 1, "forged");
        vm.recordLogs();
        send(WF_COSIGN, verdictAction(rid, txh, it, Kinds.APPROVE));
        assertEq(receiver.verdictOf(txh).decision, Kinds.PENDING);
        assertTrue(_emitted(QuorumReceiver.VerdictDowngraded.selector));
    }

    /// D14.5: two APPROVEs in the same block summing over the deposit: second becomes PENDING 51.
    function test_sameBlockOverDepositDowngraded() public {
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 100e6);
        (bytes32 r1, bytes32 t1, RequestBoard.Intent memory i1) = submitSigned(userId, userPk, address(qUSD), 100e6, 1, "a");
        (bytes32 r2, bytes32 t2, RequestBoard.Intent memory i2) = submitSigned(userId, userPk, address(qUSD), 100e6, 2, "b");
        send(WF_COSIGN, verdictAction(r1, t1, i1, Kinds.APPROVE));
        send(WF_COSIGN, verdictAction(r2, t2, i2, Kinds.APPROVE));
        assertEq(receiver.verdictOf(t1).decision, Kinds.APPROVE);
        assertEq(receiver.verdictOf(t2).decision, Kinds.PENDING);
        assertEq(receiver.approvedOf(userId, address(qUSD)), 100e6);
    }

    function test_releaseExpired() public {
        (, bytes32 txh,) = approvedWithdrawal(100e6, 1, "w1");
        assertEq(receiver.approvedOf(userId, address(qUSD)), 100e6);
        vm.expectRevert(QuorumReceiver.NotExpired.selector);
        receiver.releaseExpired(txh);
        vm.warp(nowTs() + VERDICT_TTL + 1);
        receiver.releaseExpired(txh);
        assertEq(receiver.approvedOf(userId, address(qUSD)), 0);
        vm.expectRevert(QuorumReceiver.NotExpired.selector);
        receiver.releaseExpired(txh);
    }

    function test_verdictRingCountsBySubmitMinute() public {
        uint256 t0 = nowTs();
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 1_000e6);
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = submitSigned(userId, userPk, address(qUSD), 1e6, 1, "x");
        vm.warp(t0 + 5 * 60);
        send(WF_COSIGN, verdictAction(rid, txh, it, Kinds.APPROVE));
        uint256[32] memory ring = receiver.verdictRing();
        assertEq(ring[(t0 / 60) % 32] >> 224, t0 / 60);
        assertEq(ring[(t0 / 60) % 32] & ((uint256(1) << 224) - 1), 1);
    }

    // ---------- manual lane (D27, D35) ----------
    function _queueManual(bytes32 txh, uint256[] memory idx) internal returns (bytes32) {
        uint64 dl = uint64(nowTs() + 1 hours);
        return desk.queueManual(txh, 7, dl, officerSigs(address(desk), Kinds.OA_MANUAL_APPROVE, txh, 0, 7, dl, idx));
    }

    function test_manualNeedsTwoAndDelay() public {
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 1_000e6);
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = submitSigned(userId, userPk, address(qUSD), 6_000e6, 1, "m");
        vm.expectRevert();
        _queueManual(txh, single(0));
        bytes32 id = _queueManual(txh, two());
        vm.expectRevert(OfficerDesk.NotReady.selector);
        desk.executeManual(id);
        vm.warp(nowTs() + MANUAL_DELAY);
        desk.executeManual(id);
        // manual skips quota (6,000 > quota 5,000)
        hot.execute(vaultTx(rid, it));
        assertEq(qUSD.balanceOf(payee), 6_000e6);
        assertEq(hot.quota(address(qUSD)), 5_000e6);
    }

    function test_manualCancelledByOne() public {
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = submitSigned(userId, userPk, address(qUSD), 1e6, 1, "m");
        rid;
        it;
        bytes32 id = _queueManual(txh, two());
        uint64 dl = uint64(nowTs() + 1 hours);
        desk.cancelQueued(id, 9, dl, officerSigs(address(desk), Kinds.OA_CANCEL_QUEUED, id, 0, 9, dl, single(1)));
        vm.warp(nowTs() + MANUAL_DELAY);
        vm.expectRevert(OfficerDesk.NotQueued.selector);
        desk.executeManual(id);
    }

    /// Confirmed alert + frozen warm vault: manual blocked; after freeze expiry manual works.
    function test_slowLaneAfterFreezeExpiry() public {
        QuorumReceiver.Action[] memory a = new QuorumReceiver.Action[](2);
        a[0] = QuorumReceiver.Action(Kinds.FREEZE, abi.encode(address(warm), uint64(nowTs() + 1 hours)));
        a[1] = QuorumReceiver.Action(Kinds.ALERT, abi.encode(uint8(4), uint64(nowTs() + 10 hours)));
        send(WF_TRAP, a);

        RequestBoard.Intent memory it = RequestBoard.Intent(
            ORG_A, userId, address(warm), address(qUSD), payee, 50e6, 1, uint64(nowTs() + 5 hours)
        );
        bytes32 rid = keccak256("slow");
        bytes32 txh = txHashFor(address(warm), rid, it);
        bytes32 id = _queueManual(txh, two());
        vm.warp(nowTs() + MANUAL_DELAY);
        desk.executeManual(id);
        vm.expectRevert(QuorumVault.Frozen.selector);
        warm.execute(vaultTx(rid, it));

        vm.warp(nowTs() + 1 hours);
        assertEq(receiver.alert(), 4);
        // manual approval expired meanwhile: queue again
        bytes32 id2 = desk.queueManual(
            txh, 8, uint64(nowTs() + 1 hours),
            officerSigs(address(desk), Kinds.OA_MANUAL_APPROVE, txh, 0, 8, uint64(nowTs() + 1 hours), two())
        );
        vm.warp(nowTs() + MANUAL_DELAY);
        desk.executeManual(id2);
        warm.execute(vaultTx(rid, it));
        assertEq(qUSD.balanceOf(payee), 50e6);
    }

    function test_lowerAlertTwoOfficersAndQueue() public {
        send(WF_TRAP, one(Kinds.ALERT, abi.encode(uint8(4), uint64(nowTs() + 10 hours))));
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 id = desk.queueLowerAlert(
            1, 3, dl, officerSigs(address(desk), Kinds.OA_LOWER_ALERT, ORG_A, 1, 3, dl, two())
        );
        assertEq(receiver.alert(), 4);
        vm.warp(nowTs() + MANUAL_DELAY);
        desk.executeLowerAlert(id);
        assertEq(receiver.alert(), 1);
    }

    // ---------- cold vault ----------
    function test_coldQueueToVaultUsesFund() public {
        send(WF_TRAP, confirmedPack(makeAddr("attacker"), keccak256("ev")));
        uint256 coldBal = qUSD.balanceOf(address(cold));
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 subj = keccak256(abi.encode(address(qUSD), address(warm), coldBal));
        bytes32 id = cold.queue(
            address(qUSD), address(warm), coldBal, 1, dl,
            officerSigs(address(cold), Kinds.OA_COLD_QUEUE, subj, 0, 1, dl, two())
        );
        vm.expectRevert(ColdVault.NotReady.selector);
        cold.executeQueued(id);
        vm.warp(nowTs() + 72 hours);
        (,, uint256 f0) = warm.outStats(address(qUSD));
        cold.executeQueued(id);
        (,, uint256 f1) = warm.outStats(address(qUSD));
        assertEq(f1, f0 + coldBal);
    }

    function test_coldDelayOnlyUpAndLowerViaOfficers() public {
        send(WF_TRAP, one(Kinds.COLD_DELAY, abi.encode(uint64(72 hours))));
        send(WF_TRAP, one(Kinds.COLD_DELAY, abi.encode(uint64(1 hours))));
        assertEq(cold.delay(), 72 hours);
        vm.expectRevert(ColdVault.NotReceiver.selector);
        cold.raiseDelay(100 hours);
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 id = cold.queueLowerDelay(
            24 hours, 1, dl,
            officerSigs(address(cold), Kinds.OA_COLD_LOWER_DELAY, bytes32(uint256(uint160(address(cold)))), 24 hours, 1, dl, two())
        );
        vm.warp(nowTs() + 72 hours);
        cold.executeLowerDelay(id);
        assertEq(cold.delay(), 24 hours);
    }

    function _emitted(bytes32 sig) internal returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) if (logs[i].topics[0] == sig) return true;
        return false;
    }
}
