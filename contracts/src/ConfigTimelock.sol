// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OfficerAuth} from "./lib/OfficerAuth.sol";
import {OfficerSet} from "./OfficerSet.sol";
import {Kinds} from "./lib/Kinds.sol";

/// Minimal ConfigTimelock (10_interfaces.md 3.8): two officers queue, wait CONFIG_DELAY, anyone
/// executes; one officer cancels. Calls go only to targets bound at deploy (or added through
/// the timelock itself), never to arbitrary addresses.
contract ConfigTimelock is OfficerAuth {
    error NotDeployer();
    error AlreadyInitialized();
    error UnknownTarget();
    error NotQueued();
    error NotReady();
    error CallFailed(bytes ret);
    error OnlySelf();

    event ConfigQueued(bytes32 indexed id, address target, bytes4 selector, bytes args, uint64 readyAt);
    event ConfigExecuted(bytes32 indexed id);
    event ConfigCancelled(bytes32 indexed id);
    event TargetAdded(address target);

    struct Item {
        address target;
        bytes4 selector;
        uint64 readyAt;
        bool done;
        bytes args;
    }

    address private immutable deployer;
    uint64 public immutable configDelay;
    bool public initialized;
    mapping(address => bool) public isTarget;
    mapping(bytes32 => Item) public items;

    constructor(OfficerSet officerSet_, uint64 configDelay_) OfficerAuth(officerSet_) {
        deployer = msg.sender;
        configDelay = configDelay_;
    }

    /// One-time binding of managed contracts (deploy-order cycle, D20). Locked after.
    function initialize(address[] calldata targets) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        for (uint256 i; i < targets.length; ++i) {
            isTarget[targets[i]] = true;
            emit TargetAdded(targets[i]);
        }
    }

    /// Only reachable through a queued config item targeting this contract.
    function addTarget(address target) external {
        if (msg.sender != address(this)) revert OnlySelf();
        isTarget[target] = true;
        emit TargetAdded(target);
    }

    function subjectOf(address target, bytes4 selector, bytes calldata args) public pure returns (bytes32) {
        return keccak256(abi.encode(target, selector, args));
    }

    function queue(
        address target,
        bytes4 selector,
        bytes calldata args,
        uint256 nonce,
        uint64 deadline,
        bytes[] calldata sigs
    ) external returns (bytes32 id) {
        if (!isTarget[target]) revert UnknownTarget();
        id = _consumeOfficers(Kinds.OA_CONFIG, subjectOf(target, selector, args), 0, nonce, deadline, sigs, 0);
        uint64 readyAt = uint64(block.timestamp) + configDelay;
        items[id] = Item(target, selector, readyAt, false, args);
        emit ConfigQueued(id, target, selector, args, readyAt);
    }

    function execute(bytes32 id) external {
        Item storage it = items[id];
        if (it.readyAt == 0 || it.done) revert NotQueued();
        if (block.timestamp < it.readyAt) revert NotReady();
        it.done = true;
        (bool ok, bytes memory ret) = it.target.call(abi.encodePacked(it.selector, it.args));
        if (!ok) revert CallFailed(ret);
        emit ConfigExecuted(id);
    }

    /// CANCEL_QUEUED: one officer is enough.
    function cancel(bytes32 id, uint256 nonce, uint64 deadline, bytes[] calldata sigs) external {
        Item storage it = items[id];
        if (it.readyAt == 0 || it.done) revert NotQueued();
        _consumeOfficers(Kinds.OA_CANCEL_QUEUED, id, 0, nonce, deadline, sigs, 1);
        it.done = true;
        emit ConfigCancelled(id);
    }
}
