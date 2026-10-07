// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base} from "./Base.t.sol";
import {ConfigTimelock} from "../src/ConfigTimelock.sol";
import {OfficerAuth} from "../src/lib/OfficerAuth.sol";
import {OfficerSet} from "../src/OfficerSet.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {ThreatRegistry} from "../src/ThreatRegistry.sol";
import {Kinds} from "../src/lib/Kinds.sol";

contract TimelockTest is Base {
    function _cfg() internal view returns (address target, bytes4 sel, bytes memory args) {
        target = address(hot);
        sel = QuorumVault.setCap.selector;
        args = abi.encode(address(qUSD), uint256(4_000e6));
    }

    function test_oneSignatureCannotQueue() public {
        (address t, bytes4 s, bytes memory a) = _cfg();
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes[] memory sigs = officerSigs(address(timelock), Kinds.OA_CONFIG, timelock.subjectOf(t, s, a), 0, 1, dl, single(0));
        vm.expectRevert(OfficerAuth.NotEnoughOfficers.selector);
        timelock.queue(t, s, a, 1, dl, sigs);
    }

    function test_queueWaitExecute() public {
        (address t, bytes4 s, bytes memory a) = _cfg();
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes[] memory sigs = officerSigs(address(timelock), Kinds.OA_CONFIG, timelock.subjectOf(t, s, a), 0, 1, dl, two());
        bytes32 id = timelock.queue(t, s, a, 1, dl, sigs);
        vm.expectRevert(ConfigTimelock.NotReady.selector);
        timelock.execute(id);
        vm.warp(nowTs() + CONFIG_DELAY);
        timelock.execute(id);
        assertEq(hot.cap(address(qUSD)), 4_000e6);
        // replay of the same signed action fails
        vm.expectRevert(OfficerAuth.OfficerActionUsed.selector);
        timelock.queue(t, s, a, 1, dl, sigs);
    }

    function test_oneOfficerCancels() public {
        (address t, bytes4 s, bytes memory a) = _cfg();
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 id = timelock.queue(
            t, s, a, 1, dl, officerSigs(address(timelock), Kinds.OA_CONFIG, timelock.subjectOf(t, s, a), 0, 1, dl, two())
        );
        timelock.cancel(id, 2, dl, officerSigs(address(timelock), Kinds.OA_CANCEL_QUEUED, id, 0, 2, dl, single(2)));
        vm.warp(nowTs() + CONFIG_DELAY);
        vm.expectRevert(ConfigTimelock.NotQueued.selector);
        timelock.execute(id);
    }

    function test_unknownTargetRejected() public {
        uint64 dl = uint64(nowTs() + 1 hours);
        vm.expectRevert(ConfigTimelock.UnknownTarget.selector);
        timelock.queue(makeAddr("x"), bytes4(0), "", 1, dl, new bytes[](0));
    }

    /// D20: the deployer key has no power after deployment.
    function test_deployerHasNoConfigPower() public {
        vm.expectRevert(QuorumReceiver.NotTimelock.selector);
        receiver.setWorkflow(WF_TRAP, 1);
        vm.expectRevert(QuorumReceiver.NotTimelock.selector);
        receiver.setWorkflowOwner(address(this));
        vm.expectRevert(QuorumVault.NotTimelock.selector);
        hot.setCap(address(qUSD), 1);
        vm.expectRevert(RequestBoard.NotTimelock.selector);
        board.setSubmitter(address(this), ORG_A);
        vm.expectRevert(ThreatRegistry.NotTimelock.selector);
        threats.setReporter(address(this), ORG_A);
        vm.expectRevert(OfficerSet.NotTimelock.selector);
        officers.setOfficers(new address[](0), 2);
    }

    function test_initializeOnlyOnce() public {
        vm.expectRevert(QuorumReceiver.AlreadyInitialized.selector);
        receiver.initialize(QuorumReceiver.Init(address(1), address(2), address(3), address(4), address(5), address(6), address(7)));
        vm.expectRevert(ThreatRegistry.AlreadyInitialized.selector);
        threats.initialize(new address[](0), new bytes32[](0), new address[](0));
        vm.expectRevert(ConfigTimelock.AlreadyInitialized.selector);
        timelock.initialize(new address[](0));
        vm.expectRevert(OfficerSet.AlreadyInitialized.selector);
        officers.initialize(address(1));
        vm.prank(makeAddr("eve"));
        vm.expectRevert(QuorumReceiver.NotDeployer.selector);
        receiver.initialize(QuorumReceiver.Init(address(1), address(2), address(3), address(4), address(5), address(6), address(7)));
    }
}
