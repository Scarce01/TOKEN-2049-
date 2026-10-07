// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Eip712} from "./lib/Eip712.sol";
import {Kinds} from "./lib/Kinds.sol";
import {MinuteRing} from "./lib/MinuteRing.sol";
import {
    IReceiver,
    IVaultActions,
    IColdVaultActions,
    IThreatRegistry,
    IRequestBoardView,
    IKeyRegistryView,
    IDepositVaultView,
    IDecoyCommitWrite,
    IPatrolStateWrite
} from "./interfaces/IQuorum.sol";

/// The only contract the vaults obey. It obeys only the Forwarder (whitelisted workflows) and
/// two-officer actions (10_interfaces.md 3.2). One Receiver per exchange (orgId).
contract QuorumReceiver is IReceiver, IERC165 {
    using MinuteRing for uint256[32];

    // ---------- errors ----------
    error NotForwarder();
    error BadMetadata();
    error UnknownWorkflow();
    error NotSimOperator();
    error BadVersion();
    error WrongChain();
    error WrongOrg();
    error OnlySelf();
    error NotVault();
    error NotYet();
    error NoVerdict();
    error NotDeployer();
    error AlreadyInitialized();
    error NotTimelock();
    error NotExpired();
    error NotDesk();
    error SigExpired();
    error BadSig();
    error KeyChanged();
    error NotLonger();
    error BadLevel();
    error LengthMismatch();
    error Held();
    error BadHold();
    error HoldCooldown();
    error NotHoldable();

    // ---------- events ----------
    event ReportProcessed(bytes32 indexed caseId, bytes kinds);
    event ActionFailed(bytes32 indexed caseId, uint8 kind, bytes reason);
    event ActionStale(bytes32 indexed caseId, uint8 kind);
    event VerdictRecorded(
        bytes32 indexed txHash,
        uint8 decision,
        bytes32 indexed caseId,
        bytes32 requestId,
        uint8 publicReason,
        bytes sealedReason
    );
    event VerdictDuplicate(bytes32 indexed txHash);
    event VerdictOrphaned(bytes32 indexed txHash, bytes32 requestId);
    event VerdictDowngraded(bytes32 indexed txHash, uint8 reason);
    event Tightened(bytes32 indexed caseId, uint8 kind);
    event ThreatSkipped(bytes32 indexed caseId);
    event AlertSet(uint8 level, uint64 expiresAt);
    event FreezeSet(address indexed vault, uint64 until);
    event VerdictReleased(bytes32 indexed txHash);
    event LargeNewFloor(bytes32 indexed txHash, uint64 notBefore);
    event VerdictHeld(bytes32 indexed txHash, uint64 until);
    event VerdictCancelled(bytes32 indexed txHash);
    event UserCancelled(bytes32 indexed txHash);
    event PasskeyNewFloor(bytes32 indexed txHash, uint64 notBefore);
    event LargeNewMinSet(address indexed token, uint256 min);
    event Ping(bytes32 note);
    event WorkflowSet(bytes10 name, uint256 kindMask);
    event WorkflowOwnerSet(address owner);
    event ScoreUpdated(bytes32 indexed scoreKey);
    event ScoreConflict(bytes32 indexed requestId);
    event VerdictSkipped(bytes32 indexed txHash, bytes32 requestId);

    // ---------- types ----------
    struct Action {
        uint8 kind;
        bytes data;
    }

    struct Verdict {
        uint8 decision;
        bool used;
        bool released;
        uint64 notBefore;
        uint64 expiresAt;
        bytes32 requestId;
        bytes32 userIdHash;
        address token;
        uint256 amount;
    }

    struct ManualApproval {
        uint64 expiresAt;
        bool used;
    }

    uint8 public constant MODE_PROD = 0;
    uint8 public constant MODE_SIM = 1;

    // ---------- immutables ----------
    address public immutable forwarder;
    uint8 public immutable mode;
    address public immutable simOperator;
    bytes32 public immutable orgId;
    address public immutable timelock;
    IRequestBoardView public immutable requestBoard;
    IKeyRegistryView public immutable keyRegistry;
    IDepositVaultView public immutable depositVault;
    uint64 public immutable deployedMinute;
    uint64 public immutable reportMaxAge;
    uint64 public immutable verdictTtl;
    uint64 public immutable manualDelay;
    /// docs/47 R2 contract floor and the one-officer HOLD cap; fixed at deploy.
    uint64 public immutable largeNewDelay;
    uint64 public immutable holdMax;
    /// docs/47 3.6: a passkey paying a never-paid address waits at least this long (blind-signing defence).
    uint64 public immutable passkeyNewDelay;
    address private immutable deployer;

    // ---------- bound once by initialize (deploy-order cycle, D20) ----------
    address public hotVault;
    address public warmVault;
    address public coldVault;
    IThreatRegistry public threatRegistry;
    IDecoyCommitWrite public decoyCommit;
    IPatrolStateWrite public patrolState;

    // ---------- timelock config ----------
    function setLargeNewMin(address token, uint256 min) external {
        if (msg.sender != timelock) revert NotTimelock();
        largeNewMin[token] = min;
        emit LargeNewMinSet(token, min);
    }

    address public workflowOwner;
    mapping(bytes10 => uint256) public kindMaskOf;

    // ---------- state ----------
    bytes32 public lastPing;
    uint8 public alertLevel;
    uint64 public alertExpiresAt;
    /// The OfficerDesk that verifies officer signatures for this org; set once at initialize.
    address public desk;
    mapping(address => uint64) public frozenUntil;
    mapping(bytes32 => Verdict) private _verdicts;
    mapping(bytes32 => ManualApproval) public manualOf;
    /// docs/47 R2: amount above this (per token) to a never-paid recipient waits at least largeNewDelay. 0 = off.
    mapping(address => uint256) public largeNewMin;
    mapping(bytes32 => uint64) public heldUntil;
    mapping(bytes32 => mapping(address => uint256)) public approvedOf;
    mapping(bytes32 => uint64) private _seenAt; // keccak(userIdHash, to) => first payment time
    uint256[32] private _verdictRing;
    mapping(bytes32 => bytes) private _scores; // scoreKey => ciphertext
    mapping(bytes32 => bool) private _scoreSeen; // keccak(scoreKey, requestId)
    bool private _scoreConflict; // set by SCORE, read by VERDICT in the same onReport

    struct Config {
        address forwarder;
        uint8 mode;
        address simOperator;
        bytes32 orgId;
        address timelock;
        address requestBoard;
        address keyRegistry;
        address depositVault;
        uint64 reportMaxAge;
        uint64 verdictTtl;
        uint64 manualDelay;
        address workflowOwner;
        bytes10[] workflowNames;
        uint256[] kindMasks;
        uint64 largeNewDelay;
        uint64 holdMax;
        address[] largeNewTokens;
        uint256[] largeNewMins;
        uint64 passkeyNewDelay;
    }

    constructor(Config memory c) {
        if (c.workflowNames.length != c.kindMasks.length || c.largeNewTokens.length != c.largeNewMins.length) {
            revert LengthMismatch();
        }
        forwarder = c.forwarder;
        mode = c.mode;
        simOperator = c.simOperator;
        orgId = c.orgId;
        timelock = c.timelock;
        requestBoard = IRequestBoardView(c.requestBoard);
        keyRegistry = IKeyRegistryView(c.keyRegistry);
        depositVault = IDepositVaultView(c.depositVault);
        reportMaxAge = c.reportMaxAge;
        verdictTtl = c.verdictTtl;
        manualDelay = c.manualDelay;
        largeNewDelay = c.largeNewDelay;
        holdMax = c.holdMax;
        passkeyNewDelay = c.passkeyNewDelay;
        for (uint256 i; i < c.largeNewTokens.length; ++i) {
            largeNewMin[c.largeNewTokens[i]] = c.largeNewMins[i];
            emit LargeNewMinSet(c.largeNewTokens[i], c.largeNewMins[i]);
        }
        deployedMinute = uint64(block.timestamp / 60);
        deployer = msg.sender;
        workflowOwner = c.workflowOwner;
        for (uint256 i; i < c.workflowNames.length; ++i) {
            kindMaskOf[c.workflowNames[i]] = c.kindMasks[i];
            emit WorkflowSet(c.workflowNames[i], c.kindMasks[i]);
        }
    }

    struct Init {
        address hot;
        address warm;
        address cold;
        address threat;
        address decoyCommit;
        address patrolState;
        address desk;
    }

    function initialize(Init calldata i) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (hotVault != address(0)) revert AlreadyInitialized();
        hotVault = i.hot;
        warmVault = i.warm;
        coldVault = i.cold;
        threatRegistry = IThreatRegistry(i.threat);
        decoyCommit = IDecoyCommitWrite(i.decoyCommit);
        patrolState = IPatrolStateWrite(i.patrolState);
        desk = i.desk;
    }

    // ---------- timelock config ----------
    function setWorkflow(bytes10 name, uint256 kindMask) external {
        if (msg.sender != timelock) revert NotTimelock();
        kindMaskOf[name] = kindMask;
        emit WorkflowSet(name, kindMask);
    }

    function setWorkflowOwner(address owner_) external {
        if (msg.sender != timelock) revert NotTimelock();
        workflowOwner = owner_;
        emit WorkflowOwnerSet(owner_);
    }

    // ---------- views ----------
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IReceiver).interfaceId || id == type(IERC165).interfaceId;
    }

    function alert() public view returns (uint8) {
        return block.timestamp < alertExpiresAt ? alertLevel : 0;
    }

    function isFrozen(address vault) public view returns (bool) {
        return block.timestamp < frozenUntil[vault];
    }

    function isVault(address a) public view returns (bool) {
        return a != address(0) && (a == hotVault || a == warmVault);
    }

    function verdictOf(bytes32 txHash) external view returns (Verdict memory) {
        return _verdicts[txHash];
    }

    function seenRecipient(bytes32 userIdHash, address to) external view returns (bool) {
        return _seenAt[keccak256(abi.encode(userIdHash, to))] != 0;
    }

    /// docs/47 3.6: block time of the first payment to this recipient (0 = never paid).
    function seenAt(bytes32 userIdHash, address to) external view returns (uint64) {
        return _seenAt[keccak256(abi.encode(userIdHash, to))];
    }

    function scoreOf(bytes32 scoreKey) external view returns (bytes memory) {
        return _scores[scoreKey];
    }

    function verdictRing() external view returns (uint256[32] memory) {
        return _verdictRing;
    }

    // ---------- report entry ----------
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        uint256 allowed = _allowedKinds(metadata);

        (uint8 version, uint256 chainId, bytes32 org, bytes32 caseId, uint64 issuedAt, Action[] memory actions) =
            abi.decode(report, (uint8, uint256, bytes32, bytes32, uint64, Action[]));
        if (version != 1) revert BadVersion();
        if (chainId != block.chainid) revert WrongChain();
        if (org != orgId) revert WrongOrg();
        bool stale = block.timestamp > uint256(issuedAt) + reportMaxAge;

        bytes memory kinds = new bytes(actions.length);
        // SCORE must come before VERDICT; otherwise both are skipped (tightening still runs).
        bool badOrder = _verdictBeforeScore(actions);
        _scoreConflict = false;
        for (uint256 i; i < actions.length; ++i) {
            uint8 k = actions[i].kind;
            kinds[i] = bytes1(k);
            if (badOrder && (k == Kinds.SCORE || k == Kinds.VERDICT)) {
                emit ActionFailed(caseId, k, "score after verdict");
                continue;
            }
            if (allowed & Kinds.bit(k) == 0) {
                emit ActionFailed(caseId, k, "kind not allowed");
                continue;
            }
            if (stale && !Kinds.isTightening(k)) {
                emit ActionStale(caseId, k);
                continue;
            }
            try this.applyAction(k, actions[i].data, caseId) {
                if (Kinds.emitsTightened(k)) emit Tightened(caseId, k);
            } catch (bytes memory reason) {
                emit ActionFailed(caseId, k, reason);
            }
        }
        _scoreConflict = false;
        emit ReportProcessed(caseId, kinds);
    }

    function _verdictBeforeScore(Action[] memory actions) private pure returns (bool) {
        int256 v = -1;
        int256 sc = -1;
        for (uint256 i; i < actions.length; ++i) {
            if (actions[i].kind == Kinds.VERDICT && v < 0) v = int256(i);
            if (actions[i].kind == Kinds.SCORE && sc < 0) sc = int256(i);
        }
        return v >= 0 && sc >= 0 && v < sc;
    }

    function _allowedKinds(bytes calldata metadata) private view returns (uint256) {
        if (mode == MODE_SIM) {
            // SIM cannot tell workflows apart: all kinds allowed (known SIM weakness).
            if (tx.origin != simOperator) revert NotSimOperator();
            return type(uint256).max;
        }
        // abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner[, bytes2 reportId])
        if (metadata.length < 62) revert BadMetadata();
        bytes10 name = bytes10(metadata[32:42]);
        address owner_ = address(bytes20(metadata[42:62]));
        uint256 mask = kindMaskOf[name];
        if (owner_ != workflowOwner || mask == 0) revert UnknownWorkflow();
        return mask;
    }

    /// External self-call target so each action can be wrapped in try/catch.
    function applyAction(uint8 kind, bytes calldata data, bytes32 caseId) external {
        if (msg.sender != address(this)) revert OnlySelf();
        if (kind == Kinds.PING) {
            bytes32 note = abi.decode(data, (bytes32));
            lastPing = note;
            emit Ping(note);
        } else if (kind == Kinds.VERDICT) {
            _verdict(data, caseId);
        } else if (kind == Kinds.ALERT) {
            (uint8 level, uint64 expiresAt) = abi.decode(data, (uint8, uint64));
            _raiseAlert(level, expiresAt);
        } else if (kind == Kinds.FREEZE) {
            (address vault, uint64 until) = abi.decode(data, (address, uint64));
            if (!isVault(vault)) revert NotVault();
            if (until > frozenUntil[vault]) {
                frozenUntil[vault] = until;
                emit FreezeSet(vault, until);
            }
        } else if (kind == Kinds.SWEEP) {
            (address vault, address[] memory tokens) = abi.decode(data, (address, address[]));
            if (!isVault(vault)) revert NotVault();
            IVaultActions(vault).sweepToCold(tokens);
        } else if (kind == Kinds.QUOTA_ZERO) {
            (address vault, address[] memory tokens) = abi.decode(data, (address, address[]));
            if (!isVault(vault)) revert NotVault();
            IVaultActions(vault).zeroQuota(tokens);
        } else if (kind == Kinds.COLD_DELAY) {
            uint64 d = abi.decode(data, (uint64));
            IColdVaultActions(coldVault).raiseDelay(d);
        } else if (kind == Kinds.THREAT) {
            _threat(data, caseId);
        } else if (kind == Kinds.QUOTA_REFILL) {
            (address vault, address token, uint64 epoch, uint256 amount) =
                abi.decode(data, (address, address, uint64, uint256));
            if (!isVault(vault)) revert NotVault();
            IVaultActions(vault).refillQuota(token, epoch, amount);
        } else if (kind == Kinds.SCORE) {
            _score(data);
        } else if (kind == Kinds.THRESHOLD_COMMIT) {
            (uint64 epoch, address token, bytes32 commitment) = abi.decode(data, (uint64, address, bytes32));
            decoyCommit.commitThreshold(orgId, epoch, token, commitment);
        } else if (kind == Kinds.THRESHOLD_REVEAL) {
            (uint64 epoch, address token, uint256 thr, bytes32 nonce) =
                abi.decode(data, (uint64, address, uint256, bytes32));
            decoyCommit.revealThreshold(orgId, epoch, token, thr, nonce);
        } else if (kind == Kinds.PATROL_STATE) {
            (address vault, address token, uint64 minute, uint256 S, bool alarm, bool gap) =
                abi.decode(data, (address, address, uint64, uint256, bool, bool));
            if (!isVault(vault)) revert NotVault();
            patrolState.writePatrolState(vault, token, minute, S, alarm, gap);
        } else if (kind == Kinds.ASSET_CHECKPOINT) {
            (bytes32 org, address token, uint64 safeBlock, int256 value) =
                abi.decode(data, (bytes32, address, uint64, int256));
            if (org != orgId) revert WrongOrg();
            patrolState.writeAssetCheckpoint(org, token, safeBlock, value);
        } else if (kind == Kinds.TOPUP) {
            (address fromVault, address toVault, address token, uint256 target) =
                abi.decode(data, (address, address, address, uint256));
            if (fromVault != warmVault || toVault != hotVault || fromVault == address(0)) revert NotVault();
            IVaultActions(fromVault).topUp(token, target);
        } else {
            revert NotYet();
        }
    }

    // ---------- actions ----------
    function _raiseAlert(uint8 level, uint64 expiresAt) private {
        if (level == 0 || level > Kinds.CONFIRMED) revert BadLevel();
        uint8 cur = alert();
        if (level > cur) {
            alertLevel = level;
            alertExpiresAt = expiresAt;
            emit AlertSet(level, expiresAt);
        } else if (level == cur && expiresAt > alertExpiresAt) {
            alertExpiresAt = expiresAt;
            emit AlertSet(level, expiresAt);
        }
    }

    function _threat(bytes calldata data, bytes32 caseId) private {
        (
            address suspect,
            uint64 chainId,
            bytes32 evidenceHash,
            bytes32 fingerprintHash,
            uint64 expiresAt,
            bytes32 parentEvidence,
            bytes memory proof
        ) = abi.decode(data, (address, uint64, bytes32, bytes32, uint64, bytes32, bytes));
        if (suspect == address(0)) {
            emit ThreatSkipped(caseId);
            return;
        }
        threatRegistry.add(suspect, chainId, evidenceHash, fingerprintHash, expiresAt, parentEvidence, orgId, proof);
    }

    /// Encrypted account score, compare-and-swap (10_interfaces.md kind 9).
    function _score(bytes calldata data) private {
        (bytes32 scoreKey, bytes32 requestId, bytes32 prevHash, bytes memory ct) =
            abi.decode(data, (bytes32, bytes32, bytes32, bytes));
        bytes32 seen = keccak256(abi.encode(scoreKey, requestId));
        if (_scoreSeen[seen]) return; // same event re-run: quiet, not a conflict
        bytes memory cur = _scores[scoreKey];
        bytes32 curHash = cur.length == 0 ? bytes32(0) : keccak256(cur);
        if (prevHash != curHash) {
            _scoreConflict = true;
            emit ScoreConflict(requestId);
            return;
        }
        _scores[scoreKey] = ct;
        _scoreSeen[seen] = true;
        emit ScoreUpdated(scoreKey);
    }

    function _verdict(bytes calldata data, bytes32 caseId) private {
        (
            bytes32 requestId,
            bytes32 txHash,
            bytes32 userIdHash,
            address token,
            uint256 amount,
            uint8 decision,
            uint8 publicReason,
            uint64 notBefore,
            uint64 expiresAt,
            bytes memory sealedReason
        ) = abi.decode(data, (bytes32, bytes32, bytes32, address, uint256, uint8, uint8, uint64, uint64, bytes));

        if (_verdicts[txHash].decision != Kinds.NONE) {
            emit VerdictDuplicate(txHash);
            return;
        }
        if (_scoreConflict) {
            // another request of this user wrote the score first: no verdict, the backend resubmits
            emit VerdictSkipped(txHash, requestId);
            return;
        }
        if (requestBoard.txHashOf(requestId) != txHash || txHash == bytes32(0)) {
            emit VerdictOrphaned(txHash, requestId);
            return;
        }
        if (decision < Kinds.APPROVE || decision > Kinds.PENDING) revert BadLevel();

        if (decision == Kinds.APPROVE) {
            address key = keyRegistry.keyOf(userIdHash);
            uint8 downgrade;
            if (key == address(0) || requestBoard.signerOf(requestId) != key) {
                downgrade = 31;
            } else if (approvedOf[userIdHash][token] + amount > depositVault.depositedOf(userIdHash, token)) {
                downgrade = 51;
            }
            if (downgrade != 0) {
                decision = Kinds.PENDING;
                notBefore = 0;
                expiresAt = 0;
                emit VerdictDowngraded(txHash, downgrade);
            } else {
                approvedOf[userIdHash][token] += amount;
                // docs/47 R2 floor and 3.6 passkey floor: the contract sets the minimum, CRE can only make it longer
                bool unseen = _seenAt[keccak256(abi.encode(userIdHash, requestBoard.recipientOf(requestId)))] == 0;
                uint256 lmin = largeNewMin[token];
                if (lmin != 0 && amount > lmin && unseen) {
                    uint64 floor = uint64(block.timestamp) + largeNewDelay;
                    if (notBefore < floor) {
                        notBefore = floor;
                        emit LargeNewFloor(txHash, floor);
                    }
                }
                if (unseen && passkeyNewDelay != 0 && requestBoard.signerKindOf(requestId) == 2) {
                    uint64 pfloor = uint64(block.timestamp) + passkeyNewDelay;
                    if (notBefore < pfloor) {
                        notBefore = pfloor;
                        emit PasskeyNewFloor(txHash, pfloor);
                    }
                }
                if (notBefore != 0 && expiresAt < notBefore + verdictTtl) expiresAt = notBefore + verdictTtl;
            }
        } else {
            notBefore = 0;
            expiresAt = 0;
        }

        _verdicts[txHash] = Verdict(decision, false, false, notBefore, expiresAt, requestId, userIdHash, token, amount);
        _verdictRing.add(requestBoard.submittedAt(requestId) / 60, 1);
        emit VerdictRecorded(txHash, decision, caseId, requestId, publicReason, sealedReason);
    }

    // ---------- vault hooks ----------
    function consumeVerdict(bytes32 txHash, bytes32 userIdHash, address to)
        external
        returns (bool manual, uint64 notBefore)
    {
        if (!isVault(msg.sender)) revert NotVault();
        Verdict storage v = _verdicts[txHash];
        if (block.timestamp < heldUntil[txHash]) revert Held();
        if (
            v.decision == Kinds.APPROVE && !v.used && !v.released && block.timestamp <= v.expiresAt
                && v.userIdHash == userIdHash
        ) {
            // docs/47 3.6: the key that signed this request must still be the user's key
            if (requestBoard.signerOf(v.requestId) != keyRegistry.keyOf(userIdHash)) revert KeyChanged();
            v.used = true;
            notBefore = v.notBefore;
        } else {
            ManualApproval storage m = manualOf[txHash];
            if (m.expiresAt == 0 || m.used || block.timestamp > m.expiresAt) revert NoVerdict();
            m.used = true;
            manual = true;
        }
        bytes32 sk = keccak256(abi.encode(userIdHash, to));
        if (_seenAt[sk] == 0) _seenAt[sk] = uint64(block.timestamp);
    }

    /// Expired, unused APPROVE gives back its share of approvedOf (gate 5).
    function releaseExpired(bytes32 txHash) external {
        Verdict storage v = _verdicts[txHash];
        if (v.decision != Kinds.APPROVE || v.used || v.released || block.timestamp <= v.expiresAt) {
            revert NotExpired();
        }
        v.released = true;
        approvedOf[v.userIdHash][v.token] -= v.amount;
        emit VerdictReleased(txHash);
    }

    // ---------- desk primitives (OfficerDesk only; officer signatures are verified there) ----------
    modifier onlyDesk() {
        if (desk == address(0) || msg.sender != desk) revert NotDesk();
        _;
    }

    /// Two officers on the desk; only extends.
    function deskExtendFreeze(address vault, uint64 until) external onlyDesk {
        if (!isVault(vault)) revert NotVault();
        if (until <= frozenUntil[vault]) revert NotLonger();
        frozenUntil[vault] = until;
        emit FreezeSet(vault, until);
    }

    /// Two officers plus MANUAL_DELAY on the desk: a manual approval usable for verdictTtl.
    function deskManualApprove(bytes32 txHash) external onlyDesk {
        manualOf[txHash] = ManualApproval(uint64(block.timestamp) + verdictTtl, false);
    }

    /// Two officers plus MANUAL_DELAY on the desk; only lowers.
    function deskLowerAlert(uint8 lvl) external onlyDesk {
        if (lvl < alert()) {
            alertLevel = lvl;
            if (lvl == 0) alertExpiresAt = 0;
            emit AlertSet(lvl, alertExpiresAt);
        }
    }

    /// One officer on the desk pauses one unused APPROVE, at most holdMax, and not again on the same
    /// withdrawal until holdMax after the last hold ended (a stolen officer key cannot lock it forever).
    function deskHold(bytes32 txHash, uint64 until) external onlyDesk {
        Verdict storage v = _verdicts[txHash];
        if (v.decision != Kinds.APPROVE || v.used || v.released) revert NotHoldable();
        if (until <= block.timestamp || until > block.timestamp + holdMax) revert BadHold();
        uint64 last = heldUntil[txHash];
        if (last != 0 && block.timestamp < last + holdMax) revert HoldCooldown();
        heldUntil[txHash] = until;
        if (v.expiresAt < until + verdictTtl) v.expiresAt = until + verdictTtl; // the hold must not kill the verdict
        emit VerdictHeld(txHash, until);
    }

    /// Two officers on the desk drop one unused APPROVE and give back its share of approvedOf.
    function deskCancelVerdict(bytes32 txHash) external onlyDesk {
        _cancel(txHash);
        emit VerdictCancelled(txHash);
    }

    // ---------- user actions (docs/47 3.3) ----------
    bytes32 private constant CANCEL_TYPEHASH = keccak256("CancelWithdrawal(bytes32 txHash,uint64 deadline)");
    bytes32 private constant NAME_HASH = keccak256("QuorumReceiver");
    bytes32 private constant VERSION_HASH = keccak256("1");

    function cancelDigest(bytes32 txHash, uint64 deadline) public view returns (bytes32) {
        return Eip712.digest(
            Eip712.domain(NAME_HASH, VERSION_HASH, address(this)),
            keccak256(abi.encode(CANCEL_TYPEHASH, txHash, deadline))
        );
    }

    /// The user drops their own unused APPROVE with their registered key; anyone may relay the signature.
    /// No nonce needed: a cancelled verdict cannot be cancelled again, and the digest names this contract.
    function userCancelVerdict(bytes32 txHash, uint64 deadline, bytes calldata sig) external {
        if (block.timestamp > deadline) revert SigExpired();
        address key = keyRegistry.keyOf(_verdicts[txHash].userIdHash);
        if (key == address(0) || ECDSA.recover(cancelDigest(txHash, deadline), sig) != key) revert BadSig();
        _cancel(txHash);
        emit UserCancelled(txHash);
    }

    function _cancel(bytes32 txHash) private {
        Verdict storage v = _verdicts[txHash];
        if (v.decision != Kinds.APPROVE || v.used || v.released) revert NotHoldable();
        v.released = true;
        approvedOf[v.userIdHash][v.token] -= v.amount;
    }
}
