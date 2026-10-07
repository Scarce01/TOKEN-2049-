// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Eip712} from "./lib/Eip712.sol";
import {MinuteRing} from "./lib/MinuteRing.sol";
import {WebAuthn} from "./lib/WebAuthn.sol";

/// Public board where an (untrusted) exchange backend posts withdrawal requests with the user's
/// EIP-712 intent signature (10_interfaces.md 3.1). It records facts only; Cosign judges.
contract RequestBoard {
    using MinuteRing for uint256[32];

    error NotSubmitter();
    error WrongOrg();
    error SubmitRateLimited();
    error RequestIdUsed();
    error IntentNonceUsed();
    error UnknownRequest();
    error ContentMismatch();
    error TooEarly();
    error NotTimelock();
    error LengthMismatch();

    event WithdrawalRequested(
        bytes32 indexed requestId,
        bytes32 indexed orgId,
        bytes32 indexed userIdHash,
        Request request,
        Intent intent,
        address signer
    );
    event SubmitterSet(address indexed submitter, bytes32 orgId);

    struct SafeTx {
        address to;
        uint256 value;
        bytes data;
        uint8 operation;
    }

    struct Request {
        bytes32 requestId;
        bytes32 orgId;
        bytes32 userIdHash;
        uint8 kind;
        address vault;
        address token;
        address to;
        uint256 amount;
        uint256 nonce;
        uint64 deadline;
        bytes32 txHash;
        SafeTx safeTx;
    }

    struct Intent {
        bytes32 orgId;
        bytes32 userIdHash;
        address vault;
        address token;
        address to;
        uint256 amount;
        uint256 nonce;
        uint64 deadline;
    }

    struct Bucket {
        uint128 capacity; // micro-tokens
        uint64 refillMs; // milliseconds per token
        uint128 level; // micro-tokens
        uint64 last; // timestamp of last update
    }

    bytes32 internal constant WITHDRAWAL_TYPEHASH = keccak256(
        "Withdrawal(bytes32 orgId,bytes32 userIdHash,address vault,address token,address to,uint256 amount,uint256 nonce,uint64 deadline)"
    );
    bytes32 private constant NAME_HASH = keccak256("Quorum");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint128 private constant UNIT = 1e6;

    address public immutable timelock;
    uint64 public immutable resubmitAfter;

    mapping(address => bytes32) public orgOfSubmitter;
    mapping(bytes32 => Bucket) public bucketOf;
    mapping(bytes32 => uint256[32]) private _reqRing;

    mapping(bytes32 => bytes32) public txHashOf;
    mapping(bytes32 => address) public signerOf;
    mapping(bytes32 => uint64) public submittedAt;
    mapping(bytes32 => uint64) public lastSentAt;
    mapping(bytes32 => bytes32) public contentHash;
    /// docs/47: the recipient the user signed (intent.to); the Receiver uses it for the new-address floor.
    mapping(bytes32 => address) public recipientOf;
    /// docs/47 3.6: 0 invalid, 1 wallet ECDSA, 2 passkey (WebAuthn); the Receiver applies the passkey floor from it.
    mapping(bytes32 => uint8) public signerKindOf;
    mapping(bytes32 => mapping(uint256 => bool)) public intentNonceUsed;

    constructor(
        address timelock_,
        uint64 resubmitAfter_,
        bytes32[] memory orgIds,
        uint128[] memory capacities,
        uint64[] memory refillMs,
        address[] memory submitters,
        bytes32[] memory submitterOrgs
    ) {
        if (orgIds.length != capacities.length || orgIds.length != refillMs.length) {
            revert LengthMismatch();
        }
        if (submitters.length != submitterOrgs.length) revert LengthMismatch();
        timelock = timelock_;
        resubmitAfter = resubmitAfter_;
        for (uint256 i; i < orgIds.length; ++i) {
            uint128 cap = capacities[i] * UNIT;
            bucketOf[orgIds[i]] = Bucket(cap, refillMs[i], cap, uint64(block.timestamp));
        }
        for (uint256 i; i < submitters.length; ++i) {
            orgOfSubmitter[submitters[i]] = submitterOrgs[i];
            emit SubmitterSet(submitters[i], submitterOrgs[i]);
        }
    }

    function setSubmitter(address submitter, bytes32 orgId) external {
        if (msg.sender != timelock) revert NotTimelock();
        orgOfSubmitter[submitter] = orgId;
        emit SubmitterSet(submitter, orgId);
    }

    function intentDigest(Intent calldata it) public view returns (bytes32) {
        bytes32 s = keccak256(
            abi.encode(
                WITHDRAWAL_TYPEHASH,
                it.orgId,
                it.userIdHash,
                it.vault,
                it.token,
                it.to,
                it.amount,
                it.nonce,
                it.deadline
            )
        );
        return Eip712.digest(Eip712.domain(NAME_HASH, VERSION_HASH, address(this)), s);
    }

    function submit(Request calldata req, Intent calldata intent, bytes calldata userSig) external {
        bytes32 org = orgOfSubmitter[msg.sender];
        if (org == bytes32(0)) revert NotSubmitter();
        if (req.orgId != org) revert WrongOrg();
        _take(org);
        if (submittedAt[req.requestId] != 0) revert RequestIdUsed();
        // Invalid signatures record signer = 0; judging is Cosign's job.
        address signer = _signerOf(intentDigest(intent), userSig);
        if (intentNonceUsed[intent.userIdHash][intent.nonce]) revert IntentNonceUsed();
        intentNonceUsed[intent.userIdHash][intent.nonce] = true;

        txHashOf[req.requestId] = req.txHash;
        signerOf[req.requestId] = signer;
        signerKindOf[req.requestId] = signer == address(0) ? 0 : (userSig.length == 65 ? 1 : 2);
        recipientOf[req.requestId] = intent.to;
        submittedAt[req.requestId] = uint64(block.timestamp);
        lastSentAt[req.requestId] = uint64(block.timestamp);
        contentHash[req.requestId] = keccak256(abi.encode(req, intent, userSig));
        _reqRing[org].bump(block.timestamp / 60);
        emit WithdrawalRequested(req.requestId, req.orgId, req.userIdHash, req, intent, signer);
    }

    /// Re-emits the same event when no verdict arrived (dropped event or rejected report).
    function resubmit(Request calldata req, Intent calldata intent, bytes calldata userSig) external {
        bytes32 org = orgOfSubmitter[msg.sender];
        if (org == bytes32(0)) revert NotSubmitter();
        if (req.orgId != org) revert WrongOrg();
        bytes32 h = contentHash[req.requestId];
        if (h == bytes32(0)) revert UnknownRequest();
        if (keccak256(abi.encode(req, intent, userSig)) != h) revert ContentMismatch();
        if (block.timestamp < lastSentAt[req.requestId] + resubmitAfter) revert TooEarly();
        _take(org);
        lastSentAt[req.requestId] = uint64(block.timestamp);
        emit WithdrawalRequested(req.requestId, req.orgId, req.userIdHash, req, intent, signerOf[req.requestId]);
    }

    /// Wallet ECDSA (65 bytes) or a passkey WebAuthn blob (docs/47 3.4). Invalid or malformed gives 0, never reverts.
    function _signerOf(bytes32 digest, bytes calldata sig) private view returns (address signer) {
        if (sig.length == 65) {
            (signer,,) = ECDSA.tryRecover(digest, sig);
        } else {
            try this.webauthnSigner(digest, sig) returns (address s) {
                signer = s;
            } catch {}
        }
    }

    function webauthnSigner(bytes32 digest, bytes calldata sig) external view returns (address) {
        return WebAuthn.signerOf(digest, sig);
    }

    function reqRing(bytes32 orgId) external view returns (uint256[32] memory) {
        return _reqRing[orgId];
    }

    function bucketLevel(bytes32 orgId) public view returns (uint128) {
        Bucket memory b = bucketOf[orgId];
        if (b.refillMs == 0) return 0;
        uint256 lvl = uint256(b.level) + (block.timestamp - b.last) * 1000 * UNIT / b.refillMs;
        return lvl > b.capacity ? b.capacity : uint128(lvl);
    }

    function _take(bytes32 org) private {
        uint128 lvl = bucketLevel(org);
        if (lvl < UNIT) revert SubmitRateLimited();
        Bucket storage b = bucketOf[org];
        b.level = lvl - UNIT;
        b.last = uint64(block.timestamp);
    }
}
