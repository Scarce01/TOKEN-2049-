// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Kinds} from "./lib/Kinds.sol";
import {OfficerAuth} from "./lib/OfficerAuth.sol";
import {OfficerSet} from "./OfficerSet.sol";
import {QuorumReceiver} from "./QuorumReceiver.sol";

/// Officer actions for one QuorumReceiver (docs/47 3.2, split out for contract size).
/// Verifies OfficerAction signatures (verifyingContract = this desk), runs the MANUAL_DELAY queue and
/// calls the Receiver's desk-only primitives. Every state-dependent check stays in the Receiver.
/// No owner, no config: the officer set and the receiver are fixed at construction.
contract OfficerDesk is OfficerAuth {
    error NotQueued();
    error NotReady();
    error BadLevel();

    event ManualQueued(bytes32 indexed id, uint8 kind, bytes32 subject, uint256 value, uint64 readyAt);
    event ManualExecuted(bytes32 indexed id, uint8 kind, bytes32 subject, uint256 value);
    event QueuedCancelled(bytes32 indexed id);

    struct Queued {
        uint8 kind;
        bool done;
        uint64 readyAt;
        bytes32 subject;
        uint256 value;
    }

    QuorumReceiver public immutable receiver;
    uint64 public immutable manualDelay;
    mapping(bytes32 => Queued) public queued;

    constructor(OfficerSet officerSet_, QuorumReceiver receiver_) OfficerAuth(officerSet_) {
        receiver = receiver_;
        manualDelay = receiver_.manualDelay();
    }

    /// EXTEND_FREEZE: two officers, immediate, only extends.
    function extendFreeze(address vault, uint64 until, uint256 nonce, uint64 deadline, bytes[] calldata sigs) external {
        _consumeOfficers(Kinds.OA_EXTEND_FREEZE, bytes32(uint256(uint160(vault))), until, nonce, deadline, sigs, 0);
        receiver.deskExtendFreeze(vault, until);
    }

    /// HOLD_VERDICT: one officer pauses one unused APPROVE (cap, expiry and cooldown enforced by the Receiver).
    function holdVerdict(bytes32 txHash, uint64 until, uint256 nonce, uint64 deadline, bytes[] calldata sigs) external {
        _consumeOfficers(Kinds.OA_HOLD_VERDICT, txHash, until, nonce, deadline, sigs, 1);
        receiver.deskHold(txHash, until);
    }

    /// CANCEL_VERDICT: two officers drop one unused APPROVE.
    function cancelVerdict(bytes32 txHash, uint256 nonce, uint64 deadline, bytes[] calldata sigs) external {
        _consumeOfficers(Kinds.OA_CANCEL_VERDICT, txHash, 0, nonce, deadline, sigs, 0);
        receiver.deskCancelVerdict(txHash);
    }

    /// MANUAL_APPROVE: two officers, then MANUAL_DELAY.
    function queueManual(bytes32 txHash, uint256 nonce, uint64 deadline, bytes[] calldata sigs)
        external
        returns (bytes32 id)
    {
        id = _consumeOfficers(Kinds.OA_MANUAL_APPROVE, txHash, 0, nonce, deadline, sigs, 0);
        _queue(id, Kinds.OA_MANUAL_APPROVE, txHash, 0);
    }

    /// LOWER_ALERT: two officers, then MANUAL_DELAY.
    function queueLowerAlert(uint8 newLevel, uint256 nonce, uint64 deadline, bytes[] calldata sigs)
        external
        returns (bytes32 id)
    {
        if (newLevel > Kinds.CONFIRMED) revert BadLevel();
        bytes32 orgId = receiver.orgId();
        id = _consumeOfficers(Kinds.OA_LOWER_ALERT, orgId, newLevel, nonce, deadline, sigs, 0);
        _queue(id, Kinds.OA_LOWER_ALERT, orgId, newLevel);
    }

    function executeManual(bytes32 id) external {
        Queued storage q = _ready(id, Kinds.OA_MANUAL_APPROVE);
        q.done = true;
        receiver.deskManualApprove(q.subject);
        emit ManualExecuted(id, q.kind, q.subject, q.value);
    }

    function executeLowerAlert(bytes32 id) external {
        Queued storage q = _ready(id, Kinds.OA_LOWER_ALERT);
        q.done = true;
        receiver.deskLowerAlert(uint8(q.value));
        emit ManualExecuted(id, q.kind, q.subject, q.value);
    }

    /// CANCEL_QUEUED: one officer is enough.
    function cancelQueued(bytes32 id, uint256 nonce, uint64 deadline, bytes[] calldata sigs) external {
        Queued storage q = queued[id];
        if (q.readyAt == 0 || q.done) revert NotQueued();
        _consumeOfficers(Kinds.OA_CANCEL_QUEUED, id, 0, nonce, deadline, sigs, 1);
        q.done = true;
        emit QueuedCancelled(id);
    }

    function _queue(bytes32 id, uint8 kind, bytes32 subject, uint256 value) private {
        uint64 readyAt = uint64(block.timestamp) + manualDelay;
        queued[id] = Queued(kind, false, readyAt, subject, value);
        emit ManualQueued(id, kind, subject, value, readyAt);
    }

    function _ready(bytes32 id, uint8 kind) private view returns (Queued storage q) {
        q = queued[id];
        if (q.readyAt == 0 || q.done || q.kind != kind) revert NotQueued();
        if (block.timestamp < q.readyAt) revert NotReady();
    }
}
