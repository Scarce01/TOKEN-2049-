// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Flow} from "./Flow.t.sol";
import {OfficerDesk} from "../src/OfficerDesk.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {OfficerAuth} from "../src/lib/OfficerAuth.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// docs/47 3.2: officer actions live on OfficerDesk; the Receiver only listens to its desk.
contract DeskTest is Flow {
    function test_deskPrimitivesRejectNonDesk() public {
        vm.startPrank(makeAddr("stranger"));
        vm.expectRevert(QuorumReceiver.NotDesk.selector);
        receiver.deskExtendFreeze(address(warm), uint64(nowTs() + 1 hours));
        vm.expectRevert(QuorumReceiver.NotDesk.selector);
        receiver.deskManualApprove(bytes32(uint256(1)));
        vm.expectRevert(QuorumReceiver.NotDesk.selector);
        receiver.deskLowerAlert(0);
        vm.expectRevert(QuorumReceiver.NotDesk.selector);
        receiver.deskHold(bytes32(uint256(1)), uint64(nowTs() + 1 hours));
        vm.expectRevert(QuorumReceiver.NotDesk.selector);
        receiver.deskCancelVerdict(bytes32(uint256(1)));
        vm.stopPrank();
    }

    function test_deskSetOnceAtInitialize() public {
        assertEq(receiver.desk(), address(desk));
        vm.expectRevert(QuorumReceiver.AlreadyInitialized.selector);
        receiver.initialize(
            QuorumReceiver.Init(
                address(hot),
                address(warm),
                address(cold),
                address(threats),
                address(decoys),
                address(patrol),
                makeAddr("evilDesk")
            )
        );
    }

    /// A signature made against the Receiver's address as verifyingContract is not valid on the desk.
    function test_signatureForReceiverDomainFailsOnDesk() public {
        uint64 until = uint64(nowTs() + 5 hours);
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 subj = bytes32(uint256(uint160(address(warm))));
        bytes[] memory wrong = officerSigs(address(receiver), Kinds.OA_EXTEND_FREEZE, subj, until, 1, dl, two());
        vm.expectRevert(OfficerAuth.NotOfficer.selector);
        desk.extendFreeze(address(warm), until, 1, dl, wrong);
    }

    function test_deskHasNoOwnerOrConfig() public view {
        assertEq(address(desk.receiver()), address(receiver));
        assertEq(address(desk.officerSet()), address(officers));
    }
}
