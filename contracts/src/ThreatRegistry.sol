// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IDecoyCommit {
    function verifyMem(bytes32 orgId, uint256 chainId, bytes32 ident, bytes32 salt, bytes32[] memory proof)
        external
        view
        returns (bool);
}

/// Network-wide suspect list (10_interfaces.md 3.7). Entries carry evidence, dedupe by
/// evidenceHash, only mark (never block, never delete) and expire on their own.
contract ThreatRegistry {
    error NotReporter();
    error NotDeployer();
    error AlreadyInitialized();
    error NotTimelock();
    error ZeroSuspect();
    error ProtectedAddress();
    error ParentInvalid();
    error BadExpiry();
    error BadProof();

    event ThreatAdded(
        address indexed suspect,
        bytes32 indexed evidenceHash,
        bytes32 fingerprintHash,
        bytes32 reporterOrg,
        uint64 expiresAt,
        uint32 count,
        bytes32 parentEvidence
    );
    event ReporterSet(address receiver, bytes32 orgId);
    event ProtectedSet(address a, bool protected_);

    struct Entry {
        uint64 chainId;
        uint64 firstSeen;
        uint64 expiresAt;
        uint32 count;
        bool derived;
        bytes32 evidenceHash; // latest
        bytes32 fingerprintHash;
        bytes32 reporterOrg;
    }

    address private immutable deployer;
    address public immutable timelock;
    /// Phase 5: when set, a non-derived entry must prove its decoy was committed in advance.
    IDecoyCommit public immutable decoyCommit;
    bool public initialized;

    mapping(address => bytes32) public reporterOrgOf; // receiver => orgId
    mapping(address => bool) public isProtected; // our own contracts
    mapping(address => Entry) private _entries;
    mapping(bytes32 => uint64) public evidenceExpiresAt; // evidenceHash => expiry (0 = unseen)
    mapping(bytes32 => uint64) public fingerprintExpiresAt;

    /// Longest allowed entry life; bounds the buckets activeConfirmedCount reads (THREAT_TTL is 72 h).
    uint64 public constant MAX_TTL = 7 days;
    /// Confirmed (non-derived) entries by expiry hour. Reading is O(MAX_TTL / 1 h), never O(history).
    mapping(uint64 => uint256) private _confirmedByHour;

    constructor(address timelock_, address decoyCommit_) {
        deployer = msg.sender;
        timelock = timelock_;
        decoyCommit = IDecoyCommit(decoyCommit_);
    }

    /// One-time: both Receivers and the protected set (deploy-order cycle, D20). Locked after.
    function initialize(address[] calldata receivers, bytes32[] calldata orgIds, address[] calldata protected_)
        external
    {
        if (msg.sender != deployer) revert NotDeployer();
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        for (uint256 i; i < receivers.length; ++i) {
            reporterOrgOf[receivers[i]] = orgIds[i];
            emit ReporterSet(receivers[i], orgIds[i]);
        }
        for (uint256 i; i < protected_.length; ++i) {
            isProtected[protected_[i]] = true;
            emit ProtectedSet(protected_[i], true);
        }
    }

    function setReporter(address receiver, bytes32 orgId) external {
        if (msg.sender != timelock) revert NotTimelock();
        reporterOrgOf[receiver] = orgId;
        emit ReporterSet(receiver, orgId);
    }

    function setProtected(address a, bool p) external {
        if (msg.sender != timelock) revert NotTimelock();
        isProtected[a] = p;
        emit ProtectedSet(a, p);
    }

    function add(
        address suspect,
        uint64 chainId,
        bytes32 evidenceHash,
        bytes32 fingerprintHash,
        uint64 expiresAt,
        bytes32 parentEvidence,
        bytes32 reporterOrg,
        bytes calldata proof // abi.encode(bytes32 ident, bytes32 salt, bytes32[] path); empty for derived entries
    ) external {
        bytes32 org = reporterOrgOf[msg.sender];
        if (org == bytes32(0) || org != reporterOrg) revert NotReporter();
        if (suspect == address(0)) revert ZeroSuspect();
        if (isProtected[suspect]) revert ProtectedAddress();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_TTL) revert BadExpiry();
        bool derived = parentEvidence != bytes32(0);
        if (derived && evidenceExpiresAt[parentEvidence] <= block.timestamp) revert ParentInvalid();
        if (!derived && address(decoyCommit) != address(0)) {
            if (proof.length == 0) revert BadProof();
            (bytes32 ident, bytes32 salt, bytes32[] memory path) = abi.decode(proof, (bytes32, bytes32, bytes32[]));
            if (!decoyCommit.verifyMem(reporterOrg, chainId, ident, salt, path)) revert BadProof();
        }

        // Same evidence again: no new count, no renewal (renewal needs new evidence).
        if (evidenceExpiresAt[evidenceHash] != 0) return;
        evidenceExpiresAt[evidenceHash] = expiresAt;

        Entry storage e = _entries[suspect];
        if (e.count == 0) {
            e.chainId = chainId;
            e.firstSeen = uint64(block.timestamp);
            e.reporterOrg = reporterOrg;
            e.derived = derived;
        } else if (!derived) {
            e.derived = false;
        }
        e.count += 1;
        if (expiresAt > e.expiresAt) e.expiresAt = expiresAt;
        e.evidenceHash = evidenceHash;
        if (fingerprintHash != bytes32(0)) {
            e.fingerprintHash = fingerprintHash;
            if (expiresAt > fingerprintExpiresAt[fingerprintHash]) fingerprintExpiresAt[fingerprintHash] = expiresAt;
        }
        if (!derived) ++_confirmedByHour[expiresAt / 1 hours];
        emit ThreatAdded(suspect, evidenceHash, fingerprintHash, reporterOrg, e.expiresAt, e.count, parentEvidence);
    }

    function isSuspect(address a) external view returns (bool) {
        return _entries[a].expiresAt > block.timestamp;
    }

    function entryOf(address a) external view returns (Entry memory e) {
        e = _entries[a];
        if (e.expiresAt <= block.timestamp) e.count = 0;
    }

    function fingerprintActive(bytes32 fp) external view returns (bool) {
        return fingerprintExpiresAt[fp] > block.timestamp;
    }

    /// Entries expiring in the current hour still count until the hour ends (errs toward tightening by < 1 h).
    function activeConfirmedCount() external view returns (uint256 n) {
        uint64 h = uint64(block.timestamp / 1 hours);
        for (uint64 i; i <= MAX_TTL / 1 hours; ++i) {
            n += _confirmedByHour[h + i];
        }
    }
}
