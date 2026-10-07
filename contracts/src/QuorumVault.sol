// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MinuteRing} from "./lib/MinuteRing.sol";
import {Kinds} from "./lib/Kinds.sol";
import {IQuorumReceiverView} from "./interfaces/IQuorum.sol";

/// Hot / warm vault (10_interfaces.md 3.3). Can only transfer: to a user after a consumed
/// verdict, to cold on SWEEP, to the sibling hot vault on TOPUP. No delegatecall, not upgradeable.
contract QuorumVault {
    using SafeERC20 for IERC20;
    using MinuteRing for uint256[32];

    error AlreadyPaid();
    error Frozen();
    error TokenNotAllowed();
    error NotYetValid();
    error AlertConfirmed();
    error QuotaExceeded();
    error NotReceiver();
    error NotTimelock();
    error BadEpoch();
    error OverRate();
    error NotWarm();
    error LengthMismatch();
    error WindowExceeded();
    error NativeMismatch();
    error NativeSendFailed();
    error BadLane();

    event Executed(bytes32 indexed txHash, address indexed token, address indexed to, uint256 amount, bool manual);
    event Swept(address indexed token, uint256 amount);
    event QuotaZeroed(address indexed token);
    event QuotaRefilled(address indexed token, uint64 epoch, uint256 amount, uint256 quota);
    event TopUp(address indexed token, uint256 amount);
    event Funded(address indexed token, address indexed from, uint256 amount);
    event CapSet(address indexed token, uint256 cap);
    event WindowCapsSet(address indexed token, uint256 hourCap, uint256 dayCap);
    event ProtectedLaneSet(
        address indexed token, uint256 smallCap, uint256 cap, uint256 refillPerMin, uint256 reserve, uint64 matureAge
    );
    event ProtectedRelease(address indexed token, address indexed to, uint256 amount);

    struct VaultTx {
        bytes32 requestId;
        bytes32 userIdHash;
        address token;
        address to;
        uint256 amount;
        uint256 nonce;
        uint64 deadline;
    }

    struct Stats {
        uint256 outCount;
        uint256 extOutTotal;
        uint256 fundedTotal;
    }

    IQuorumReceiverView public immutable receiver;
    address public immutable cold;
    address public immutable sibling; // warm vault: its hot vault; hot vault: 0
    address public immutable timelock;
    bool public immutable isHot;
    uint64 public immutable quotaPeriod;

    address[] private _tokens;
    mapping(address => bool) public tokenAllowed;
    mapping(address => uint256) public cap;
    mapping(address => uint256) public quota;
    mapping(address => uint256) public rMax;
    mapping(address => uint256) public hourCap;
    mapping(address => uint256) public dayCap;
    // docs/47 R7 protected lane (off until a timelock enables it): during a freeze / CONFIRMED alert, a withdrawal
    // to a recipient the user already paid long ago, at or below smallCap, is released from a separate budget R.
    mapping(address => uint64) public matureAge;
    mapping(address => uint256) public smallCap;
    mapping(address => uint256) public protectedCap;
    mapping(address => uint256) public protectedRefill;
    mapping(address => uint256) public reserve;
    mapping(address => uint256) public pBudget;
    mapping(address => uint64) public pEpoch;

    struct Window {
        uint64 hour;
        uint64 day;
        uint256 hourOut;
        uint256 dayOut;
    }

    mapping(address => Window) private _window;
    mapping(address => uint64) public lastEpoch;
    mapping(address => Stats) private _stats;
    mapping(address => uint256[32]) private _outRing;
    mapping(bytes32 => mapping(uint256 => bool)) public paid;

    struct Config {
        address receiver;
        address cold;
        address sibling;
        address timelock;
        bool isHot;
        uint64 quotaPeriod;
        address[] tokens;
        uint256[] caps;
        uint256[] initialQuotas;
        uint256[] rMax;
        uint256[] hourCaps; // docs/47 R8; empty = no hourly cap
        uint256[] dayCaps; // empty = no daily cap
    }

    constructor(Config memory c) {
        uint256 n = c.tokens.length;
        if (c.caps.length != n || c.initialQuotas.length != n || c.rMax.length != n) revert LengthMismatch();
        if ((c.hourCaps.length != 0 && c.hourCaps.length != n) || (c.dayCaps.length != 0 && c.dayCaps.length != n)) {
            revert LengthMismatch();
        }
        receiver = IQuorumReceiverView(c.receiver);
        cold = c.cold;
        sibling = c.sibling;
        timelock = c.timelock;
        isHot = c.isHot;
        quotaPeriod = c.quotaPeriod;
        uint64 epoch = uint64(block.timestamp / c.quotaPeriod);
        for (uint256 i; i < n; ++i) {
            address t = c.tokens[i];
            _tokens.push(t);
            tokenAllowed[t] = true;
            cap[t] = c.caps[i];
            quota[t] = c.initialQuotas[i] > c.caps[i] ? c.caps[i] : c.initialQuotas[i];
            rMax[t] = c.rMax[i];
            lastEpoch[t] = epoch;
            if (c.hourCaps.length != 0) hourCap[t] = c.hourCaps[i];
            if (c.dayCaps.length != 0) dayCap[t] = c.dayCaps[i];
        }
    }

    receive() external payable {}

    modifier onlyReceiver() {
        if (msg.sender != address(receiver)) revert NotReceiver();
        _;
    }

    // ---------- views ----------
    function txHashOf(VaultTx calldata t) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid, address(this), t.requestId, t.userIdHash, t.token, t.to, t.amount, t.nonce, t.deadline
            )
        );
    }

    function tokens() external view returns (address[] memory) {
        return _tokens;
    }

    function outStats(address token)
        external
        view
        returns (uint256 outCount, uint256 extOutTotal, uint256 fundedTotal)
    {
        Stats memory s = _stats[token];
        return (s.outCount, s.extOutTotal, s.fundedTotal);
    }

    function outRing(address token) external view returns (uint256[32] memory) {
        return _outRing[token];
    }

    function configHash() public view returns (bytes32) {
        uint256 n = _tokens.length;
        uint256[] memory caps = new uint256[](n);
        uint256[] memory rmaxes = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            caps[i] = cap[_tokens[i]];
            rmaxes[i] = rMax[_tokens[i]];
        }
        return keccak256(abi.encode(address(receiver), cold, sibling, _tokens, caps, rmaxes));
    }

    function balanceOf(address token) public view returns (uint256) {
        return token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    // ---------- withdrawals ----------
    function execute(VaultTx calldata t) external {
        bytes32 txHash = txHashOf(t);
        if (paid[t.userIdHash][t.nonce]) revert AlreadyPaid();
        paid[t.userIdHash][t.nonce] = true;
        if (!tokenAllowed[t.token]) revert TokenNotAllowed();
        // R7: first-payment time as it was before this payment; consumeVerdict stamps it for a never-paid address
        uint64 seenBefore = protectedCap[t.token] != 0 ? receiver.seenAt(t.userIdHash, t.to) : 0;
        (bool manual, uint64 notBefore) = receiver.consumeVerdict(txHash, t.userIdHash, t.to);
        if (block.timestamp < notBefore) revert NotYetValid();
        bool frozen = receiver.isFrozen(address(this));
        if (manual) {
            if (frozen) revert Frozen(); // a freeze is a hard stop even for two-officer manual approvals
        } else if (frozen || receiver.alert() >= Kinds.CONFIRMED) {
            // docs/47 R7: only a mature recipient, small amount, from budget R gets through; everything else waits
            if (!_consumeProtected(t, seenBefore)) {
                if (frozen) revert Frozen();
                revert AlertConfirmed();
            }
        } else {
            uint256 q = quota[t.token];
            if (q < t.amount) revert QuotaExceeded();
            quota[t.token] = q - t.amount;
            _takeWindow(t.token, t.amount);
        }
        Stats storage s = _stats[t.token];
        s.outCount += 1;
        s.extOutTotal += t.amount;
        if (isHot) _outRing[t.token].add(block.timestamp / 60, t.amount);
        _send(t.token, t.to, t.amount);
        emit Executed(txHash, t.token, t.to, t.amount, manual);
    }

    /// Exchange top-ups and cold releases go through here so asset conservation can count them.
    function fund(address token, uint256 amount) external payable {
        if (!tokenAllowed[token]) revert TokenNotAllowed();
        if (token == address(0)) {
            if (msg.value != amount) revert NativeMismatch();
        } else {
            if (msg.value != 0) revert NativeMismatch();
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
        _stats[token].fundedTotal += amount;
        emit Funded(token, msg.sender, amount);
    }

    // ---------- receiver actions ----------
    function sweepToCold(address[] calldata toks) external onlyReceiver {
        for (uint256 i; i < toks.length; ++i) {
            uint256 bal = balanceOf(toks[i]);
            uint256 res = reserve[toks[i]];
            if (bal <= res) continue; // keep the protected-lane reserve (docs/47 R7)
            uint256 amt = bal - res;
            _stats[toks[i]].extOutTotal += amt;
            _send(toks[i], cold, amt);
            emit Swept(toks[i], amt);
        }
    }

    function zeroQuota(address[] calldata toks) external onlyReceiver {
        for (uint256 i; i < toks.length; ++i) {
            quota[toks[i]] = 0;
            emit QuotaZeroed(toks[i]);
        }
    }

    function refillQuota(address token, uint64 epoch, uint256 amount) external onlyReceiver {
        _requireClean();
        uint64 last = lastEpoch[token];
        if (epoch <= last || epoch > block.timestamp / quotaPeriod) revert BadEpoch();
        if (amount > rMax[token] * (epoch - last)) revert OverRate();
        lastEpoch[token] = epoch;
        uint256 q = quota[token] + amount;
        if (q > cap[token]) q = cap[token];
        quota[token] = q;
        emit QuotaRefilled(token, epoch, amount, q);
    }

    /// Warm vault only: bring the sibling hot vault up to targetBalance (internal transfer).
    function topUp(address token, uint256 targetBalance) external onlyReceiver {
        if (sibling == address(0)) revert NotWarm();
        _requireClean();
        if (receiver.isFrozen(sibling)) revert Frozen();
        uint256 hotBal = token == address(0) ? sibling.balance : IERC20(token).balanceOf(sibling);
        if (hotBal >= targetBalance) return;
        uint256 amt = targetBalance - hotBal;
        uint256 mine = balanceOf(token);
        if (amt > mine) amt = mine;
        if (amt == 0) return;
        _send(token, sibling, amt);
        emit TopUp(token, amt);
    }

    // ---------- timelock config ----------
    function setCap(address token, uint256 newCap) external {
        if (msg.sender != timelock) revert NotTimelock();
        if (!tokenAllowed[token]) revert TokenNotAllowed();
        cap[token] = newCap;
        if (quota[token] > newCap) quota[token] = newCap;
        emit CapSet(token, newCap);
    }

    /// docs/47 R8: hourly and daily outflow caps for non-manual payouts (0 = no cap). Timelock only.
    function setWindowCaps(address token, uint256 hourCap_, uint256 dayCap_) external {
        if (msg.sender != timelock) revert NotTimelock();
        if (!tokenAllowed[token]) revert TokenNotAllowed();
        hourCap[token] = hourCap_;
        dayCap[token] = dayCap_;
        emit WindowCapsSet(token, hourCap_, dayCap_);
    }

    /// docs/47 R7: enable (cap_ > 0) or disable (cap_ = 0) the protected lane for a token. Timelock only.
    function setProtectedLane(
        address token,
        uint256 smallCap_,
        uint256 cap_,
        uint256 refillPerMin_,
        uint256 reserve_,
        uint64 matureAge_
    ) external {
        if (msg.sender != timelock) revert NotTimelock();
        if (!tokenAllowed[token]) revert TokenNotAllowed();
        // off: no reserve. on: a never-paid address must never count as mature, and the reserve only funds the lane
        if (cap_ == 0 ? reserve_ != 0 : (matureAge_ == 0 || reserve_ > cap_)) revert BadLane();
        smallCap[token] = smallCap_;
        protectedCap[token] = cap_;
        protectedRefill[token] = refillPerMin_;
        reserve[token] = reserve_;
        matureAge[token] = matureAge_;
        pEpoch[token] = uint64(block.timestamp / 60);
        pBudget[token] = cap_;
        emit ProtectedLaneSet(token, smallCap_, cap_, refillPerMin_, reserve_, matureAge_);
    }

    // ---------- internal ----------
    // ponytail: fixed UTC hour/day windows, so up to 2x a cap can leave across a boundary; a sliding window
    // (minute ring sums) if that matters.
    function _takeWindow(address token, uint256 amount) private {
        Window storage w = _window[token];
        uint64 h = uint64(block.timestamp / 1 hours);
        uint64 d = uint64(block.timestamp / 1 days);
        if (w.hour != h) (w.hour, w.hourOut) = (h, 0);
        if (w.day != d) (w.day, w.dayOut) = (d, 0);
        uint256 hc = hourCap[token];
        uint256 dc = dayCap[token];
        if ((hc != 0 && w.hourOut + amount > hc) || (dc != 0 && w.dayOut + amount > dc)) revert WindowExceeded();
        w.hourOut += amount;
        w.dayOut += amount;
    }

    /// docs/47 R7: true (and consumes budget R) for a mature recipient, small amount, within R, during a freeze.
    function _consumeProtected(VaultTx calldata t, uint64 seen) private returns (bool) {
        uint256 pcap = protectedCap[t.token];
        if (pcap == 0 || t.amount > smallCap[t.token]) return false; // lane off or not small
        if (seen == 0 || block.timestamp < seen + matureAge[t.token]) return false; // never paid, or not mature
        uint64 epoch = uint64(block.timestamp / 60);
        uint256 b = pBudget[t.token];
        uint64 last = pEpoch[t.token];
        if (epoch > last) {
            b += protectedRefill[t.token] * (epoch - last);
            if (b > pcap) b = pcap;
            pEpoch[t.token] = epoch;
        }
        if (b < t.amount) {
            pBudget[t.token] = b;
            return false; // budget R exhausted
        }
        pBudget[t.token] = b - t.amount;
        emit ProtectedRelease(t.token, t.to, t.amount);
        return true;
    }

    function _requireClean() private view {
        if (receiver.alert() >= Kinds.CONFIRMED) revert AlertConfirmed();
        if (receiver.isFrozen(address(this))) revert Frozen();
    }

    function _send(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeSendFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
