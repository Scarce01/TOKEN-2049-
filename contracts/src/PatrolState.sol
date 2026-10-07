// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OfficerAuth} from "./lib/OfficerAuth.sol";
import {OfficerSet} from "./OfficerSet.sol";
import {Kinds} from "./lib/Kinds.sol";

interface IReceiverVaults {
    function hotVault() external view returns (address);
    function warmVault() external view returns (address);
    function orgId() external view returns (bytes32);
}

/// Patrol checkpoints (10_interfaces.md kinds 13 and 14) plus the two officer actions that adjust them:
/// PLANNED_OP (kind 8, immediate) and RESET_ASSET_CHECKPOINT (kind 9, queued MANUAL_DELAY).
/// Writes come only from registered Receivers.
contract PatrolState is OfficerAuth {
    error NotReceiver();
    error NotDeployer();
    error AlreadyInitialized();
    error StaleMinute();
    error StaleBlock();
    error AssetValueDecreased();
    error BadWindow();
    error NotQueued();
    error NotReady();
    error UnknownOrg();

    event PatrolStateUpdated(address indexed vault, address indexed token, uint64 minute, uint256 S, bool alarm, bool gap);
    event AssetCheckpoint(bytes32 indexed orgId, address indexed token, uint64 safeBlock, int256 assetValue, bytes32 vaultSetHash);
    event PlannedOpRegistered(
        address indexed vault, address indexed token, uint64 windowStart, uint64 windowEnd, uint256 perMinute, uint64 registeredMinute
    );
    event AssetResetQueued(bytes32 indexed id, bytes32 orgId, address token, int256 value, uint64 readyAt);
    event AssetResetExecuted(bytes32 indexed id);
    event QueuedCancelled(bytes32 indexed id);

    struct Checkpoint {
        uint64 minute;
        bool alarm;
        bool gap;
        uint256 S;
    }

    struct Asset {
        uint64 safeBlock;
        bool set;
        int256 value;
        bytes32 vaultSetHash;
    }

    struct PlannedOp {
        address vault;
        address token;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 registeredMinute;
        uint256 perMinute;
    }

    struct Reset {
        bytes32 orgId;
        address token;
        int256 value;
        uint64 readyAt;
        bool done;
    }

    uint64 public constant PLANNED_OP_MAX_WINDOW = 24 hours;

    address private immutable deployer;
    uint64 public immutable manualDelay;
    bool public initialized;

    mapping(address => bytes32) public orgOfReceiver;
    mapping(bytes32 => address) public receiverOf;
    mapping(address => mapping(address => Checkpoint)) public checkpointOf; // vault => token
    mapping(bytes32 => mapping(address => Asset)) public assetOf; // orgId => token
    mapping(uint64 => PlannedOp[]) private _plannedByHour; // hour of windowStart
    mapping(bytes32 => Reset) public resets;

    constructor(OfficerSet officerSet_, uint64 manualDelay_) OfficerAuth(officerSet_) {
        deployer = msg.sender;
        manualDelay = manualDelay_;
    }

    function initialize(address[] calldata receivers) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        for (uint256 i; i < receivers.length; ++i) {
            bytes32 org = IReceiverVaults(receivers[i]).orgId();
            orgOfReceiver[receivers[i]] = org;
            receiverOf[org] = receivers[i];
        }
    }

    function vaultSetHash(bytes32 orgId) public view returns (bytes32) {
        address r = receiverOf[orgId];
        if (r == address(0)) revert UnknownOrg();
        return keccak256(abi.encode(IReceiverVaults(r).hotVault(), IReceiverVaults(r).warmVault()));
    }

    // ---------- receiver writes ----------
    function writePatrolState(address vault, address token, uint64 minute, uint256 S, bool alarm, bool gap) external {
        bytes32 org = orgOfReceiver[msg.sender];
        if (org == bytes32(0)) revert NotReceiver();
        Checkpoint storage c = checkpointOf[vault][token];
        if (minute <= c.minute) revert StaleMinute();
        checkpointOf[vault][token] = Checkpoint(minute, alarm, gap, S);
        emit PatrolStateUpdated(vault, token, minute, S, alarm, gap);
    }

    /// High-water mark of V at SAFE blocks. May only fall when the vault set changed (the contract
    /// computes the hash itself) or after an officer reset.
    function writeAssetCheckpoint(bytes32 orgId, address token, uint64 safeBlock, int256 value) external {
        if (orgOfReceiver[msg.sender] != orgId || orgId == bytes32(0)) revert NotReceiver();
        Asset storage a = assetOf[orgId][token];
        bytes32 vs = vaultSetHash(orgId);
        if (a.set && safeBlock <= a.safeBlock) revert StaleBlock();
        if (a.set && a.vaultSetHash == vs && value < a.value) revert AssetValueDecreased();
        assetOf[orgId][token] = Asset(safeBlock, true, value, vs);
        emit AssetCheckpoint(orgId, token, safeBlock, value, vs);
    }

    // ---------- officer actions ----------
    /// PLANNED_OP: two officers, effective immediately; window <= 24 h. Never loosens a verdict,
    /// only discounts the CUSUM input for the listed minutes.
    function registerPlannedOp(
        address vault,
        address token,
        uint64 windowStart,
        uint64 windowEnd,
        uint256 perMinute,
        uint256 nonce,
        uint64 deadline,
        bytes[] calldata sigs
    ) external {
        if (windowEnd <= windowStart || windowEnd - windowStart > PLANNED_OP_MAX_WINDOW) revert BadWindow();
        bytes32 subject = keccak256(abi.encode(vault, token, windowStart, windowEnd));
        _consumeOfficers(Kinds.OA_PLANNED_OP, subject, perMinute, nonce, deadline, sigs, 0);
        uint64 reg = uint64(block.timestamp / 60);
        _plannedByHour[windowStart / 3600].push(PlannedOp(vault, token, windowStart, windowEnd, reg, perMinute));
        emit PlannedOpRegistered(vault, token, windowStart, windowEnd, perMinute, reg);
    }

    /// All ops whose windowStart falls in hours [fromHour, toHour] (expired ones included).
    function plannedOps(uint64 fromHour, uint64 toHour) external view returns (PlannedOp[] memory out) {
        uint256 n;
        for (uint64 h = fromHour; h <= toHour; ++h) n += _plannedByHour[h].length;
        out = new PlannedOp[](n);
        uint256 k;
        for (uint64 h = fromHour; h <= toHour; ++h) {
            PlannedOp[] storage b = _plannedByHour[h];
            for (uint256 i; i < b.length; ++i) out[k++] = b[i];
        }
    }

    /// RESET_ASSET_CHECKPOINT: two officers, queued MANUAL_DELAY; subject = keccak(orgId, token).
    function queueAssetReset(bytes32 orgId, address token, int256 value, uint256 nonce, uint64 deadline, bytes[] calldata sigs)
        external
        returns (bytes32 id)
    {
        bytes32 subject = keccak256(abi.encode(orgId, token));
        id = _consumeOfficers(Kinds.OA_RESET_ASSET_CHECKPOINT, subject, uint256(value), nonce, deadline, sigs, 0);
        uint64 readyAt = uint64(block.timestamp) + manualDelay;
        resets[id] = Reset(orgId, token, value, readyAt, false);
        emit AssetResetQueued(id, orgId, token, value, readyAt);
    }

    function executeAssetReset(bytes32 id) external {
        Reset storage r = resets[id];
        if (r.readyAt == 0 || r.done) revert NotQueued();
        if (block.timestamp < r.readyAt) revert NotReady();
        r.done = true;
        Asset storage a = assetOf[r.orgId][r.token];
        a.value = r.value;
        a.set = true;
        a.vaultSetHash = vaultSetHash(r.orgId);
        emit AssetResetExecuted(id);
        emit AssetCheckpoint(r.orgId, r.token, a.safeBlock, r.value, a.vaultSetHash);
    }

    function cancelQueued(bytes32 id, uint256 nonce, uint64 deadline, bytes[] calldata sigs) external {
        Reset storage r = resets[id];
        if (r.readyAt == 0 || r.done) revert NotQueued();
        _consumeOfficers(Kinds.OA_CANCEL_QUEUED, id, 0, nonce, deadline, sigs, 1);
        r.done = true;
        emit QueuedCancelled(id);
    }
}
