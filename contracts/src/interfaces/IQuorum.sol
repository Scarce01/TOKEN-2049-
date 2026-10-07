// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IQuorumReceiverView {
    function alert() external view returns (uint8);
    function isFrozen(address vault) external view returns (bool);
    function isVault(address a) external view returns (bool);
    function seenAt(bytes32 userIdHash, address to) external view returns (uint64);
    function consumeVerdict(bytes32 txHash, bytes32 userIdHash, address to)
        external
        returns (bool manual, uint64 notBefore);
}

interface IVaultActions {
    function sweepToCold(address[] calldata tokens) external;
    function zeroQuota(address[] calldata tokens) external;
    function refillQuota(address token, uint64 epoch, uint256 amount) external;
    function topUp(address token, uint256 targetBalance) external;
}

interface IColdVaultActions {
    function raiseDelay(uint64 newDelay) external;
}

interface IThreatRegistry {
    function add(
        address suspect,
        uint64 chainId,
        bytes32 evidenceHash,
        bytes32 fingerprintHash,
        uint64 expiresAt,
        bytes32 parentEvidence,
        bytes32 reporterOrg,
        bytes calldata proof
    ) external;
    function isSuspect(address a) external view returns (bool);
    function fingerprintActive(bytes32 fp) external view returns (bool);
    function activeConfirmedCount() external view returns (uint256);
}

interface IRequestBoardView {
    function txHashOf(bytes32 requestId) external view returns (bytes32);
    function signerOf(bytes32 requestId) external view returns (address);
    function submittedAt(bytes32 requestId) external view returns (uint64);
    function recipientOf(bytes32 requestId) external view returns (address);
    function signerKindOf(bytes32 requestId) external view returns (uint8);
}

interface IKeyRegistryView {
    function keyOf(bytes32 userIdHash) external view returns (address);
}

interface IDepositVaultView {
    function depositedOf(bytes32 userIdHash, address token) external view returns (uint256);
}

interface IDecoyCommitWrite {
    function commitThreshold(bytes32 orgId, uint64 epoch, address token, bytes32 commitment) external;
    function revealThreshold(bytes32 orgId, uint64 epoch, address token, uint256 threshold, bytes32 nonce) external;
}

interface IPatrolStateWrite {
    function writePatrolState(address vault, address token, uint64 minute, uint256 S, bool alarm, bool gap) external;
    function writeAssetCheckpoint(bytes32 orgId, address token, uint64 safeBlock, int256 value) external;
}
