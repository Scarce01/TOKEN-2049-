// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// Salted Merkle commitment of each org's decoys and per-epoch hidden-threshold commitments
/// (10_interfaces.md 8.2, proposal 6 C and D). It proves a decoy was committed in advance; it cannot
/// prove the triggering transaction happened (the DON attests that part).
contract DecoyCommit {
    error NotTimelock();
    error NotReceiver();
    error NotDeployer();
    error AlreadyInitialized();
    error BadLeafCount();
    error NoCommitment();
    error RevealMismatch();
    error LengthMismatch();

    event RootSet(bytes32 indexed orgId, bytes32 root, uint256 leafCount);
    event ThresholdCommitted(bytes32 indexed orgId, uint64 indexed epoch, address indexed token, bytes32 commitment);
    event ThresholdRevealed(bytes32 indexed orgId, uint64 indexed epoch, address indexed token, uint256 threshold);
    event ReceiverSet(address receiver, bytes32 orgId);

    struct Root {
        bytes32 root;
        uint256 leafCount;
    }

    address private immutable deployer;
    address public immutable timelock;
    bool public initialized;

    mapping(bytes32 => Root) public rootOf;
    mapping(address => bytes32) public orgOfReceiver;
    // keccak(orgId, epoch, token) => commitment / revealed threshold (+1 so 0 means none)
    mapping(bytes32 => bytes32) public commitmentOf;
    mapping(bytes32 => uint256) public revealedPlusOne;

    constructor(address timelock_, bytes32[] memory orgIds, bytes32[] memory roots, uint256[] memory leafCounts) {
        if (orgIds.length != roots.length || orgIds.length != leafCounts.length) revert LengthMismatch();
        deployer = msg.sender;
        timelock = timelock_;
        for (uint256 i; i < orgIds.length; ++i) _setRoot(orgIds[i], roots[i], leafCounts[i]);
    }

    /// One-time: bind the Receivers (deploy-order cycle, D20).
    function initialize(address[] calldata receivers, bytes32[] calldata orgIds) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        for (uint256 i; i < receivers.length; ++i) {
            orgOfReceiver[receivers[i]] = orgIds[i];
            emit ReceiverSet(receivers[i], orgIds[i]);
        }
    }

    function setRoot(bytes32 orgId, bytes32 root, uint256 leafCount) external {
        if (msg.sender != timelock) revert NotTimelock();
        _setRoot(orgId, root, leafCount);
    }

    function _setRoot(bytes32 orgId, bytes32 root, uint256 leafCount) private {
        // padded with fake leaves to a power of two: the count does not reveal how many decoys exist
        if (leafCount == 0 || leafCount & (leafCount - 1) != 0) revert BadLeafCount();
        rootOf[orgId] = Root(root, leafCount);
        emit RootSet(orgId, root, leafCount);
    }

    function leafOf(uint256 chainId, bytes32 ident, bytes32 salt) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(chainId, ident, salt))));
    }

    function verify(bytes32 orgId, uint256 chainId, bytes32 ident, bytes32 salt, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        bytes32 root = rootOf[orgId].root;
        return root != bytes32(0) && MerkleProof.verifyCalldata(proof, root, leafOf(chainId, ident, salt));
    }

    function verifyMem(bytes32 orgId, uint256 chainId, bytes32 ident, bytes32 salt, bytes32[] memory proof)
        external
        view
        returns (bool)
    {
        bytes32 root = rootOf[orgId].root;
        return root != bytes32(0) && MerkleProof.verify(proof, root, leafOf(chainId, ident, salt));
    }

    function _key(bytes32 orgId, uint64 epoch, address token) private pure returns (bytes32) {
        return keccak256(abi.encode(orgId, epoch, token));
    }

    /// Only the org's Receiver. Same (epoch, token) twice: ignored (idempotent).
    function commitThreshold(bytes32 orgId, uint64 epoch, address token, bytes32 commitment) external {
        if (orgOfReceiver[msg.sender] != orgId || orgId == bytes32(0)) revert NotReceiver();
        bytes32 k = _key(orgId, epoch, token);
        if (commitmentOf[k] != bytes32(0)) return;
        commitmentOf[k] = commitment;
        emit ThresholdCommitted(orgId, epoch, token, commitment);
    }

    /// Reveal must match keccak256(abi.encode(threshold, nonce)); mismatch reverts.
    function revealThreshold(bytes32 orgId, uint64 epoch, address token, uint256 threshold, bytes32 nonce) external {
        if (orgOfReceiver[msg.sender] != orgId || orgId == bytes32(0)) revert NotReceiver();
        bytes32 k = _key(orgId, epoch, token);
        bytes32 c = commitmentOf[k];
        if (c == bytes32(0)) revert NoCommitment();
        if (keccak256(abi.encode(threshold, nonce)) != c) revert RevealMismatch();
        if (revealedPlusOne[k] != 0) return;
        revealedPlusOne[k] = threshold + 1;
        emit ThresholdRevealed(orgId, epoch, token, threshold);
    }

    function thresholdOf(bytes32 orgId, uint64 epoch, address token)
        external
        view
        returns (bytes32 commitment, bool revealed, uint256 threshold)
    {
        bytes32 k = _key(orgId, epoch, token);
        uint256 r = revealedPlusOne[k];
        return (commitmentOf[k], r != 0, r == 0 ? 0 : r - 1);
    }
}
