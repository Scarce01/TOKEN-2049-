// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Eip712} from "./lib/Eip712.sol";
import {OfficerAuth} from "./lib/OfficerAuth.sol";
import {WebAuthn} from "./lib/WebAuthn.sol";
import {OfficerSet} from "./OfficerSet.sol";
import {Kinds} from "./lib/Kinds.sol";
import {DepositVault} from "./DepositVault.sol";

/// User signing keys (10_interfaces.md 3.5, 3.7). A first registration is immediate only if the account has
/// never deposited; otherwise it waits keyChangeDelay. Rotation co-signed by the current and the new key is
/// immediate. Recovery (new key only) waits recoveryDelay, which a registered second factor can shorten to
/// keyChangeDelay; the current key, the second factor or one officer can cancel it meanwhile.
contract KeyRegistry is OfficerAuth {
    error BadSig();
    error Expired();
    error AlreadyHasKey();
    error NoKey();
    error PendingExists();
    error NoPending();
    error NotReady();
    error LengthMismatch();
    error NoFactor();
    error FactorExists();
    error NoPendingFactor();

    event KeyRegistered(bytes32 indexed userIdHash, address key);
    event KeyRegistrationQueued(bytes32 indexed userIdHash, address key, uint64 readyAt, bytes32 queueId);
    event KeyChangeRequested(bytes32 indexed userIdHash, address newKey, uint64 readyAt, bytes32 queueId);
    event KeyChangeCancelled(bytes32 indexed userIdHash, address key);
    event QueuedCancelled(bytes32 indexed queueId);
    event KeyRotated(bytes32 indexed userIdHash, address oldKey, address newKey);
    event RecoveryApproved(bytes32 indexed userIdHash, address newKey, uint64 readyAt);
    event FactorRegistered(bytes32 indexed userIdHash, address factor);
    event FactorQueued(bytes32 indexed userIdHash, address factor, uint64 readyAt);
    event FactorCancelled(bytes32 indexed userIdHash, address factor);

    uint8 internal constant ACT_REGISTER = 1;
    uint8 internal constant ACT_REQUEST_CHANGE = 2;
    uint8 internal constant ACT_CANCEL_CHANGE = 3;
    uint8 internal constant ACT_ROTATE = 4;
    uint8 internal constant ACT_APPROVE_RECOVERY = 5;
    uint8 internal constant ACT_FACTOR = 6;
    uint8 internal constant ACT_CANCEL_FACTOR = 7;

    bytes32 internal constant KEY_BINDING_TYPEHASH =
        keccak256("KeyBinding(bytes32 userIdHash,address key,uint8 action,uint256 nonce,uint64 deadline)");
    bytes32 private constant NAME_HASH = keccak256("QuorumKeys");
    bytes32 private constant VERSION_HASH = keccak256("1");

    struct Pending {
        address key;
        uint64 readyAt;
    }

    DepositVault public immutable depositVault;
    uint64 public immutable keyChangeDelay; // short: queued first registration, approved recovery, factor after deposits
    uint64 public immutable recoveryDelay; // long: recovery with the new key alone (docs/47 3.7)

    mapping(bytes32 => address) public keyOf;
    mapping(bytes32 => Pending) public pendingOf;
    mapping(bytes32 => uint256) public keyNonce; // per userIdHash, consumed by each KeyBinding
    mapping(bytes32 => address) public secondFactorOf;
    mapping(bytes32 => Pending) public pendingFactor;

    constructor(OfficerSet officerSet_, DepositVault depositVault_, uint64 keyChangeDelay_, uint64 recoveryDelay_)
        OfficerAuth(officerSet_)
    {
        depositVault = depositVault_;
        keyChangeDelay = keyChangeDelay_;
        recoveryDelay = recoveryDelay_;
    }

    function keyBindingDigest(bytes32 userIdHash, address key, uint8 action, uint256 nonce, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        bytes32 s = keccak256(abi.encode(KEY_BINDING_TYPEHASH, userIdHash, key, action, nonce, deadline));
        return Eip712.digest(Eip712.domain(NAME_HASH, VERSION_HASH, address(this)), s);
    }

    function queueIdOf(bytes32 userIdHash, address key, uint64 readyAt) public pure returns (bytes32) {
        return keccak256(abi.encode(userIdHash, key, readyAt));
    }

    // ---------- first registration ----------
    function register(bytes32 userIdHash, address key, uint64 deadline, bytes calldata sig) public {
        if (keyOf[userIdHash] != address(0)) revert AlreadyHasKey();
        if (pendingOf[userIdHash].key != address(0)) revert PendingExists();
        _checkBinding(userIdHash, key, ACT_REGISTER, deadline, sig, key);
        if (!depositVault.hasDeposit(userIdHash)) {
            keyOf[userIdHash] = key;
            emit KeyRegistered(userIdHash, key);
        } else {
            uint64 readyAt = uint64(block.timestamp) + keyChangeDelay;
            pendingOf[userIdHash] = Pending(key, readyAt);
            emit KeyRegistrationQueued(userIdHash, key, readyAt, queueIdOf(userIdHash, key, readyAt));
        }
    }

    function registerBatch(
        bytes32[] calldata userIdHashes,
        address[] calldata keys,
        uint64[] calldata deadlines,
        bytes[] calldata sigs
    ) external {
        uint256 n = userIdHashes.length;
        if (keys.length != n || deadlines.length != n || sigs.length != n) revert LengthMismatch();
        for (uint256 i; i < n; ++i) {
            register(userIdHashes[i], keys[i], deadlines[i], sigs[i]);
        }
    }

    // ---------- rotation: current key and new key co-sign, immediate ----------
    function rotateKey(
        bytes32 userIdHash,
        address newKey,
        uint64 deadline,
        bytes calldata sigCurrent,
        bytes calldata sigNew
    ) external {
        address old = keyOf[userIdHash];
        if (old == address(0)) revert NoKey();
        if (pendingOf[userIdHash].key != address(0)) revert PendingExists();
        bytes32 digest = _binding(userIdHash, newKey, ACT_ROTATE, deadline);
        if (_signer(digest, sigCurrent) != old) revert BadSig();
        if (_signer(digest, sigNew) != newKey || newKey == address(0)) revert BadSig();
        keyOf[userIdHash] = newKey;
        emit KeyRotated(userIdHash, old, newKey);
        emit KeyRegistered(userIdHash, newKey);
    }

    // ---------- recovery: new key alone, long delay unless the second factor approves ----------
    /// Signed by the new key. Waits recoveryDelay (docs/47 3.7).
    function requestKeyChange(bytes32 userIdHash, address newKey, uint64 deadline, bytes calldata sig) external {
        if (keyOf[userIdHash] == address(0)) revert NoKey();
        if (pendingOf[userIdHash].key != address(0)) revert PendingExists();
        _checkBinding(userIdHash, newKey, ACT_REQUEST_CHANGE, deadline, sig, newKey);
        uint64 readyAt = uint64(block.timestamp) + recoveryDelay;
        pendingOf[userIdHash] = Pending(newKey, readyAt);
        emit KeyChangeRequested(userIdHash, newKey, readyAt, queueIdOf(userIdHash, newKey, readyAt));
    }

    /// Signed by the registered second factor: the recovery becomes ready after keyChangeDelay instead.
    function approveRecovery(bytes32 userIdHash, uint64 deadline, bytes calldata sig) external {
        address factor = secondFactorOf[userIdHash];
        if (factor == address(0)) revert NoFactor();
        Pending storage p = pendingOf[userIdHash];
        if (p.key == address(0)) revert NoPending();
        _checkBinding(userIdHash, p.key, ACT_APPROVE_RECOVERY, deadline, sig, factor);
        uint64 readyAt = uint64(block.timestamp) + keyChangeDelay;
        if (readyAt < p.readyAt) p.readyAt = readyAt;
        emit RecoveryApproved(userIdHash, p.key, p.readyAt);
    }

    /// Signed by the current key or the second factor.
    function cancelKeyChange(bytes32 userIdHash, uint64 deadline, bytes calldata sig) external {
        Pending memory p = pendingOf[userIdHash];
        address old = keyOf[userIdHash];
        if (p.key == address(0) || old == address(0)) revert NoPending();
        address s = _signer(_binding(userIdHash, p.key, ACT_CANCEL_CHANGE, deadline), sig);
        if (s == address(0) || (s != old && s != secondFactorOf[userIdHash])) revert BadSig();
        delete pendingOf[userIdHash];
        emit KeyChangeCancelled(userIdHash, p.key);
    }

    /// Finalizes both queued first registrations and recoveries.
    function finalizeKeyChange(bytes32 userIdHash) external {
        Pending memory p = pendingOf[userIdHash];
        if (p.key == address(0)) revert NoPending();
        if (block.timestamp < p.readyAt) revert NotReady();
        delete pendingOf[userIdHash];
        keyOf[userIdHash] = p.key;
        emit KeyRegistered(userIdHash, p.key);
    }

    /// CANCEL_QUEUED by one officer; subject = queueIdOf(userIdHash, key, readyAt).
    function officerCancel(bytes32 userIdHash, uint256 nonce, uint64 deadline, bytes[] calldata sigs) external {
        Pending memory p = pendingOf[userIdHash];
        if (p.key == address(0)) revert NoPending();
        bytes32 qid = queueIdOf(userIdHash, p.key, p.readyAt);
        _consumeOfficers(Kinds.OA_CANCEL_QUEUED, qid, 0, nonce, deadline, sigs, 1);
        delete pendingOf[userIdHash];
        emit QueuedCancelled(qid);
    }

    // ---------- second factor: current key and factor co-sign; waits once the account holds funds ----------
    function registerSecondFactor(
        bytes32 userIdHash,
        address factor,
        uint64 deadline,
        bytes calldata sigKey,
        bytes calldata sigFactor
    ) external {
        address key = keyOf[userIdHash];
        if (key == address(0)) revert NoKey();
        if (secondFactorOf[userIdHash] != address(0) || pendingFactor[userIdHash].key != address(0)) {
            revert FactorExists();
        }
        bytes32 digest = _binding(userIdHash, factor, ACT_FACTOR, deadline);
        if (_signer(digest, sigKey) != key) revert BadSig();
        if (_signer(digest, sigFactor) != factor || factor == address(0) || factor == key) revert BadSig();
        if (!depositVault.hasDeposit(userIdHash)) {
            secondFactorOf[userIdHash] = factor;
            emit FactorRegistered(userIdHash, factor);
        } else {
            uint64 readyAt = uint64(block.timestamp) + keyChangeDelay;
            pendingFactor[userIdHash] = Pending(factor, readyAt);
            emit FactorQueued(userIdHash, factor, readyAt);
        }
    }

    function finalizeSecondFactor(bytes32 userIdHash) external {
        Pending memory p = pendingFactor[userIdHash];
        if (p.key == address(0)) revert NoPendingFactor();
        if (block.timestamp < p.readyAt) revert NotReady();
        delete pendingFactor[userIdHash];
        secondFactorOf[userIdHash] = p.key;
        emit FactorRegistered(userIdHash, p.key);
    }

    /// Signed by the current key: drops a queued or an active second factor.
    function cancelSecondFactor(bytes32 userIdHash, uint64 deadline, bytes calldata sig) external {
        address key = keyOf[userIdHash];
        address target = pendingFactor[userIdHash].key;
        if (target == address(0)) target = secondFactorOf[userIdHash];
        if (key == address(0) || target == address(0)) revert NoPendingFactor();
        _checkBinding(userIdHash, target, ACT_CANCEL_FACTOR, deadline, sig, key);
        delete pendingFactor[userIdHash];
        delete secondFactorOf[userIdHash];
        emit FactorCancelled(userIdHash, target);
    }

    // ---------- signatures ----------
    /// Consumes this account's next nonce and returns the digest every signer of this call must sign.
    function _binding(bytes32 userIdHash, address key, uint8 action, uint64 deadline) private returns (bytes32) {
        if (block.timestamp > deadline) revert Expired();
        uint256 nonce = keyNonce[userIdHash]++;
        return keyBindingDigest(userIdHash, key, action, nonce, deadline);
    }

    /// 65 bytes: wallet ECDSA; otherwise a passkey (WebAuthn) blob whose key id is the signer.
    function _signer(bytes32 digest, bytes calldata sig) private view returns (address) {
        return sig.length == 65 ? ECDSA.recover(digest, sig) : WebAuthn.signerOf(digest, sig);
    }

    function _checkBinding(
        bytes32 userIdHash,
        address key,
        uint8 action,
        uint64 deadline,
        bytes calldata sig,
        address expectedSigner
    ) private {
        address s = _signer(_binding(userIdHash, key, action, deadline), sig);
        if (s != expectedSigner || s == address(0)) revert BadSig();
    }
}
