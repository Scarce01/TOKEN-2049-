// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {Base} from "./Base.t.sol";
import {PatrolState} from "../src/PatrolState.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// Phase 6 contract parts: CUSUM checkpoint (D58), asset-conservation checkpoint (D65), PLANNED_OP.
contract Phase6Test is Base {
    function _ps(address v, address t, uint64 m, uint256 S) internal {
        send(WF_PATROL, one(Kinds.PATROL_STATE, abi.encode(v, t, m, S, false, false)));
    }

    function test_patrolStateMinuteMustIncrease() public {
        _ps(address(hot), address(qUSD), 100, 7);
        _ps(address(hot), address(qUSD), 100, 9); // same minute: rejected
        (uint64 m,,, uint256 S) = patrol.checkpointOf(address(hot), address(qUSD));
        assertEq(m, 100);
        assertEq(S, 7);
        _ps(address(hot), address(qUSD), 110, 3);
        (m,,, S) = patrol.checkpointOf(address(hot), address(qUSD));
        assertEq(m, 110);
        assertEq(S, 3);
    }

    function _ac(uint64 b, int256 v) internal {
        send(WF_PATROL, one(Kinds.ASSET_CHECKPOINT, abi.encode(ORG_A, address(qUSD), b, v)));
    }

    function test_assetCheckpointHighWater() public {
        _ac(10, 30_000e6);
        _ac(11, 31_000e6); // goes up (direct transfer in): accepted
        _ac(12, 29_000e6); // goes down: rejected
        (uint64 sb, bool set, int256 v,) = patrol.assetOf(ORG_A, address(qUSD));
        assertTrue(set);
        assertEq(sb, 11);
        assertEq(v, 31_000e6);
        _ac(11, 40_000e6); // safeBlock must increase
        (sb,, v,) = patrol.assetOf(ORG_A, address(qUSD));
        assertEq(v, 31_000e6);
    }

    function test_assetCheckpointWrongOrgRejected() public {
        vm.recordLogs();
        send(WF_PATROL, one(Kinds.ASSET_CHECKPOINT, abi.encode(ORG_B, address(qUSD), uint64(1), int256(1))));
        assertTrue(_emitted(QuorumReceiver.ActionFailed.selector));
    }

    function test_assetResetNeedsTwoAndDelay() public {
        _ac(10, 30_000e6);
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 subj = keccak256(abi.encode(ORG_A, address(qUSD)));
        int256 nv = 25_000e6;
        vm.expectRevert();
        patrol.queueAssetReset(ORG_A, address(qUSD), nv, 1, dl, officerSigs(address(patrol), Kinds.OA_RESET_ASSET_CHECKPOINT, subj, uint256(nv), 1, dl, single(0)));
        bytes32 id = patrol.queueAssetReset(
            ORG_A, address(qUSD), nv, 1, dl, officerSigs(address(patrol), Kinds.OA_RESET_ASSET_CHECKPOINT, subj, uint256(nv), 1, dl, two())
        );
        vm.expectRevert(PatrolState.NotReady.selector);
        patrol.executeAssetReset(id);
        vm.warp(nowTs() + MANUAL_DELAY);
        patrol.executeAssetReset(id);
        (,, int256 v,) = patrol.assetOf(ORG_A, address(qUSD));
        assertEq(v, nv);
        // monitoring continues from the new value
        _ac(11, 25_500e6);
        (,, v,) = patrol.assetOf(ORG_A, address(qUSD));
        assertEq(v, 25_500e6);
    }

    function test_plannedOpWindowAndSigs() public {
        uint64 ws = uint64(nowTs());
        uint64 we = ws + 2 hours;
        bytes32 subj = keccak256(abi.encode(address(hot), address(qUSD), ws, we));
        uint64 dl = uint64(nowTs() + 1 hours);
        patrol.registerPlannedOp(address(hot), address(qUSD), ws, we, 500e6, 1, dl, officerSigs(address(patrol), Kinds.OA_PLANNED_OP, subj, 500e6, 1, dl, two()));
        PatrolState.PlannedOp[] memory ops = patrol.plannedOps(ws / 3600, ws / 3600);
        assertEq(ops.length, 1);
        assertEq(ops[0].perMinute, 500e6);
        assertEq(ops[0].registeredMinute, nowTs() / 60);
        // longer than 24 h: rejected
        uint64 we2 = ws + 25 hours;
        bytes32 subj2 = keccak256(abi.encode(address(hot), address(qUSD), ws, we2));
        bytes[] memory s2 = officerSigs(address(patrol), Kinds.OA_PLANNED_OP, subj2, 1, 2, dl, two());
        vm.expectRevert(PatrolState.BadWindow.selector);
        patrol.registerPlannedOp(address(hot), address(qUSD), ws, we2, 1, 2, dl, s2);
    }

    function test_lensReturnsPatrolViews() public {
        _ps(address(hot), address(qUSD), 100, 7);
        _ac(10, 30_000e6);
        bytes32[] memory orgs = new bytes32[](1);
        orgs[0] = ORG_A;
        (bool ok, bytes memory ret) = address(lens).staticcall(abi.encodeWithSelector(lens.patrolView.selector, orgs, new address[](0)));
        assertTrue(ok);
        assertGt(ret.length, 0);
    }

    function _emitted(bytes32 sig) internal returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) if (logs[i].topics[0] == sig) return true;
        return false;
    }
}
