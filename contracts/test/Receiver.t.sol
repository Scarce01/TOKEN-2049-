// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {Flow} from "./Flow.t.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {Kinds} from "../src/lib/Kinds.sol";
import {ThreatRegistry} from "../src/ThreatRegistry.sol";

contract ReceiverTest is Flow {
    // ---------- onReport checks (D19) ----------
    function test_rejectsNonForwarder() public {
        vm.prank(makeAddr("eve"));
        vm.expectRevert(QuorumReceiver.NotForwarder.selector);
        receiver.onReport(meta(WF_PATROL, wfOwner), envelope(0, one(Kinds.PING, abi.encode(bytes32("x")))));
    }

    function test_prodRejectsWrongOwner() public {
        vm.expectRevert(QuorumReceiver.UnknownWorkflow.selector);
        receiver.onReport(meta(WF_PATROL, makeAddr("other")), envelope(0, one(Kinds.PING, abi.encode(bytes32("x")))));
    }

    function test_prodRejectsWrongName() public {
        vm.expectRevert(QuorumReceiver.UnknownWorkflow.selector);
        receiver.onReport(meta(bytes10("evil______"), wfOwner), envelope(0, one(Kinds.PING, abi.encode(bytes32("x")))));
    }

    function test_prodRejectsShortMetadata() public {
        vm.expectRevert(QuorumReceiver.BadMetadata.selector);
        receiver.onReport(hex"00", envelope(0, one(Kinds.PING, abi.encode(bytes32("x")))));
    }

    function test_metadata62And64BothDecode() public {
        receiver.onReport(meta(WF_PATROL, wfOwner), envelope(0, one(Kinds.PING, abi.encode(bytes32("62")))));
        assertEq(receiver.lastPing(), bytes32("62"));
        receiver.onReport(meta64(WF_PATROL, wfOwner), envelope(0, one(Kinds.PING, abi.encode(bytes32("64")))));
        assertEq(receiver.lastPing(), bytes32("64"));
    }

    function test_simRequiresSimOperator() public {
        address op = makeAddr("simOp");
        QuorumReceiver sim = _deployReceiver(1, op);
        bytes memory rep = envelope(0, one(Kinds.PING, abi.encode(bytes32("sim"))));
        vm.expectRevert(QuorumReceiver.NotSimOperator.selector);
        sim.onReport("", rep);
        vm.prank(address(this), op); // msg.sender = forwarder, tx.origin = simOperator
        sim.onReport("", rep);
        assertEq(sim.lastPing(), bytes32("sim"));
    }

    function test_rejectsWrongChain() public {
        bytes memory rep = abi.encode(uint8(1), block.chainid + 1, ORG_A, bytes32(0), uint64(nowTs()), one(Kinds.PING, abi.encode(bytes32("x"))));
        vm.expectRevert(QuorumReceiver.WrongChain.selector);
        receiver.onReport(meta(WF_PATROL, wfOwner), rep);
    }

    function test_rejectsWrongOrgAndVersion() public {
        bytes memory rep = abi.encode(uint8(1), block.chainid, ORG_B, bytes32(0), uint64(nowTs()), one(Kinds.PING, abi.encode(bytes32("x"))));
        vm.expectRevert(QuorumReceiver.WrongOrg.selector);
        receiver.onReport(meta(WF_PATROL, wfOwner), rep);
        rep = abi.encode(uint8(2), block.chainid, ORG_A, bytes32(0), uint64(nowTs()), one(Kinds.PING, abi.encode(bytes32("x"))));
        vm.expectRevert(QuorumReceiver.BadVersion.selector);
        receiver.onReport(meta(WF_PATROL, wfOwner), rep);
    }

    /// Stale report: loosening/state kinds skipped (ActionStale), tightening still applied.
    function test_staleReportOnlyTightens() public {
        uint64 issued = uint64(nowTs());
        vm.warp(nowTs() + REPORT_MAX_AGE + 1);
        QuorumReceiver.Action[] memory a = new QuorumReceiver.Action[](2);
        a[0] = QuorumReceiver.Action(Kinds.PING, abi.encode(bytes32("stale")));
        a[1] = QuorumReceiver.Action(Kinds.FREEZE, abi.encode(address(warm), uint64(nowTs() + 1 hours)));
        receiver.onReport(meta(WF_PATROL, wfOwner), abi.encode(uint8(1), block.chainid, ORG_A, bytes32(0), issued, a));
        assertEq(receiver.lastPing(), bytes32(0));
        assertTrue(receiver.isFrozen(address(warm)));
    }

    // ---------- kind whitelist ----------
    function test_trapCannotSendVerdict() public {
        vm.recordLogs();
        send(WF_TRAP, one(Kinds.PING, abi.encode(bytes32("nope"))));
        assertEq(receiver.lastPing(), bytes32(0));
        _assertEmitted(QuorumReceiver.ActionFailed.selector);
        vm.recordLogs();
        send(WF_TRAP, one(Kinds.VERDICT, ""));
        _assertEmitted(QuorumReceiver.ActionFailed.selector);
    }

    /// One failing action does not block the others.
    function test_failingActionIsolated() public {
        QuorumReceiver.Action[] memory a = new QuorumReceiver.Action[](3);
        a[0] = QuorumReceiver.Action(Kinds.FREEZE, abi.encode(makeAddr("notVault"), uint64(nowTs() + 1 hours)));
        a[1] = QuorumReceiver.Action(Kinds.ALERT, abi.encode(uint8(2), uint64(nowTs() + 1 hours)));
        a[2] = QuorumReceiver.Action(Kinds.FREEZE, abi.encode(address(warm), uint64(nowTs() + 1 hours)));
        send(WF_TRAP, a);
        assertEq(receiver.alert(), 2);
        assertTrue(receiver.isFrozen(address(warm)));
    }

    function test_applyActionOnlySelf() public {
        vm.expectRevert(QuorumReceiver.OnlySelf.selector);
        receiver.applyAction(Kinds.PING, abi.encode(bytes32("x")), 0);
    }

    // ---------- confirmed pack (D08) and idempotency ----------
    function test_confirmedPackTightensEverything() public {
        address attacker = makeAddr("attacker");
        uint256 coldUsd0 = qUSD.balanceOf(address(cold));
        uint256 hotUsd = qUSD.balanceOf(address(hot));
        send(WF_TRAP, confirmedPack(attacker, keccak256("ev1")));

        assertTrue(receiver.isFrozen(address(warm)));
        assertEq(receiver.frozenUntil(address(warm)), nowTs() + 2 hours);
        assertEq(hot.quota(address(qUSD)), 0);
        assertEq(hot.quota(address(qETH)), 0);
        assertEq(qUSD.balanceOf(address(hot)), 0);
        assertEq(qETH.balanceOf(address(hot)), 0);
        assertEq(qUSD.balanceOf(address(cold)), coldUsd0 + hotUsd);
        assertEq(receiver.alert(), 4);
        assertEq(cold.delay(), 72 hours);
        assertTrue(threats.isSuspect(attacker));
    }

    function test_confirmedPackTwiceSameState() public {
        address attacker = makeAddr("attacker");
        send(WF_TRAP, confirmedPack(attacker, keccak256("ev1")));
        bytes32 h1 = _stateHash(attacker);
        send(WF_TRAP, confirmedPack(attacker, keccak256("ev1")));
        assertEq(_stateHash(attacker), h1);
        assertEq(threats.entryOf(attacker).count, 1);
    }

    function test_threatDedupAndCount() public {
        address attacker = makeAddr("attacker");
        send(WF_TRAP, confirmedPack(attacker, keccak256("ev1")));
        send(WF_TRAP, confirmedPack(attacker, keccak256("ev2")));
        assertEq(threats.entryOf(attacker).count, 2);
    }

    /// Audit High 2: the count must not scan history, or a flood of entries stops Cosign for every org.
    function test_threatCountBoundedGas() public {
        ThreatRegistry tr = new ThreatRegistry(address(timelock), address(0));
        address[] memory r = new address[](1);
        r[0] = address(this);
        bytes32[] memory o = new bytes32[](1);
        o[0] = ORG_A;
        tr.initialize(r, o, new address[](0));
        uint64 t0 = uint64(nowTs());
        for (uint256 i; i < 3000; ++i) {
            tr.add(address(uint160(i + 1)), 84532, bytes32(i + 1), 0, t0 + 72 hours, 0, ORG_A, "");
        }
        uint256 g = gasleft();
        assertEq(tr.activeConfirmedCount(), 3000);
        assertLt(g - gasleft(), 600_000);
        vm.warp(t0 + 74 hours);
        assertEq(tr.activeConfirmedCount(), 0);
        vm.expectRevert(ThreatRegistry.BadExpiry.selector);
        tr.add(address(1), 84532, bytes32(uint256(9999)), 0, uint64(nowTs()) + 8 days, 0, ORG_A, "");
    }

    function test_threatZeroSuspectSkippedQuietly() public {
        vm.recordLogs();
        send(WF_TRAP, confirmedPack(address(0), keccak256("ev1")));
        _assertEmitted(QuorumReceiver.ThreatSkipped.selector);
        _assertNotEmitted(QuorumReceiver.ActionFailed.selector);
        assertEq(receiver.alert(), 4);
    }

    function test_threatOwnVaultRejected() public {
        vm.recordLogs();
        send(WF_TRAP, confirmedPack(address(hot), keccak256("ev1")));
        _assertEmitted(QuorumReceiver.ActionFailed.selector);
        assertEq(receiver.alert(), 4);
        assertTrue(receiver.isFrozen(address(warm)));
    }

    // ---------- alert ratchet (D11) ----------
    function test_alertRatchet() public {
        send(WF_TRAP, one(Kinds.ALERT, abi.encode(uint8(3), uint64(nowTs() + 1 hours))));
        send(WF_TRAP, one(Kinds.ALERT, abi.encode(uint8(1), uint64(nowTs() + 5 hours))));
        assertEq(receiver.alert(), 3);
        assertEq(receiver.alertExpiresAt(), nowTs() + 1 hours);
        // same level extends only
        send(WF_TRAP, one(Kinds.ALERT, abi.encode(uint8(3), uint64(nowTs() + 2 hours))));
        assertEq(receiver.alertExpiresAt(), nowTs() + 2 hours);
        send(WF_TRAP, one(Kinds.ALERT, abi.encode(uint8(3), uint64(nowTs() + 30 minutes))));
        assertEq(receiver.alertExpiresAt(), nowTs() + 2 hours);
        // after expiry a lower level can be set
        vm.warp(nowTs() + 2 hours + 1);
        assertEq(receiver.alert(), 0);
        send(WF_TRAP, one(Kinds.ALERT, abi.encode(uint8(1), uint64(nowTs() + 1 hours))));
        assertEq(receiver.alert(), 1);
    }

    // ---------- freeze (D09) ----------
    function test_freezeOnlyExtends() public {
        send(WF_TRAP, one(Kinds.FREEZE, abi.encode(address(warm), uint64(nowTs() + 2 hours))));
        send(WF_TRAP, one(Kinds.FREEZE, abi.encode(address(warm), uint64(nowTs() + 1 hours))));
        assertEq(receiver.frozenUntil(address(warm)), nowTs() + 2 hours);
        vm.warp(nowTs() + 2 hours);
        assertFalse(receiver.isFrozen(address(warm)));
    }

    function test_executeFrozenAndAlertConfirmed() public {
        (bytes32 rid,, RequestBoard.Intent memory it) = approvedWithdrawal(100e6, 1, "w1");
        send(WF_TRAP, one(Kinds.FREEZE, abi.encode(address(hot), uint64(nowTs() + 1 hours))));
        vm.expectRevert(QuorumVault.Frozen.selector);
        hot.execute(vaultTx(rid, it));

        vm.warp(nowTs() + 1 hours);
        (bytes32 rid2,, RequestBoard.Intent memory it2) = approvedWithdrawal(100e6, 2, "w2");
        send(WF_TRAP, one(Kinds.ALERT, abi.encode(uint8(4), uint64(nowTs() + 1 hours))));
        vm.expectRevert(QuorumVault.AlertConfirmed.selector);
        hot.execute(vaultTx(rid2, it2));
    }

    function test_extendFreezeNeedsTwoOfficers() public {
        uint64 until = uint64(nowTs() + 5 hours);
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 subj = bytes32(uint256(uint160(address(warm))));
        bytes[] memory one_ = officerSigs(address(desk), Kinds.OA_EXTEND_FREEZE, subj, until, 1, dl, single(0));
        vm.expectRevert();
        desk.extendFreeze(address(warm), until, 1, dl, one_);
        // same officer twice does not count as two
        bytes[] memory dup = new bytes[](2);
        dup[0] = one_[0];
        dup[1] = one_[0];
        vm.expectRevert();
        desk.extendFreeze(address(warm), until, 1, dl, dup);
        bytes[] memory sigs = officerSigs(address(desk), Kinds.OA_EXTEND_FREEZE, subj, until, 1, dl, two());
        desk.extendFreeze(address(warm), until, 1, dl, sigs);
        assertEq(receiver.frozenUntil(address(warm)), until);
    }

    // ---------- helpers ----------
    function _stateHash(address attacker) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                receiver.frozenUntil(address(warm)),
                hot.quota(address(qUSD)),
                hot.quota(address(qETH)),
                qUSD.balanceOf(address(hot)),
                qUSD.balanceOf(address(cold)),
                receiver.alert(),
                receiver.alertExpiresAt(),
                cold.delay(),
                threats.entryOf(attacker)
            )
        );
    }

    function _assertEmitted(bytes32 sig) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) if (logs[i].topics[0] == sig) return;
        revert("event not emitted");
    }

    function _assertNotEmitted(bytes32 sig) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) if (logs[i].topics[0] == sig) revert("event emitted");
    }
}
