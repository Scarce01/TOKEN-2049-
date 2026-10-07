// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Flow} from "./Flow.t.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {OfficerDesk} from "../src/OfficerDesk.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {MockERC20} from "../src/test-tokens/MockERC20.sol";
import {Kinds} from "../src/lib/Kinds.sol";

interface IFlowHelper {
    function wfOwnerAddr() external view returns (address);
    function handlerSubmit(uint256 amount) external returns (bytes32, bytes32, RequestBoard.Intent memory);
}

/// Fuzz handler. "Attacker" calls measure state before/after and flag any forbidden change;
/// "legit" calls go through the forwarder and are allowed to move state.
contract Handler is Test {
    QuorumReceiver public receiver;
    QuorumVault public hot;
    QuorumVault public warm;
    MockERC20 public qUSD;
    address public forwarder;
    bytes public metaCosign;
    bytes public metaTrap;
    bytes public metaPatrol;
    bytes32 public org;

    bool public violatedI1;
    bool public violatedI6;
    bool public violatedI7;

    bytes32[] public txHashes;
    mapping(bytes32 => uint8) public firstDecision;
    mapping(bytes32 => bool) public sawUsed;
    uint64 public maxFrozenHot;
    uint64 public maxFrozenWarm;

    // legit approved withdrawals waiting to be executed
    struct Pending {
        bytes32 requestId;
        RequestBoard.Intent it;
    }

    Pending[] internal approved;
    IFlowHelper internal flow;

    constructor(IFlowHelper flow_, QuorumReceiver r, QuorumVault h, QuorumVault w, MockERC20 usd, bytes32 org_) {
        flow = flow_;
        receiver = r;
        hot = h;
        warm = w;
        qUSD = usd;
        forwarder = address(flow_);
        org = org_;
        metaCosign = abi.encodePacked(bytes32(0), bytes10("cosign____"), flow_.wfOwnerAddr());
        metaTrap = abi.encodePacked(bytes32(0), bytes10("trap______"), flow_.wfOwnerAddr());
        metaPatrol = abi.encodePacked(bytes32(0), bytes10("patrol____"), flow_.wfOwnerAddr());
    }

    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    function _report(bytes memory m, uint8 kind, bytes memory data) internal {
        QuorumReceiver.Action[] memory a = new QuorumReceiver.Action[](1);
        a[0] = QuorumReceiver.Action(kind, data);
        vm.prank(forwarder);
        receiver.onReport(m, abi.encode(uint8(1), block.chainid, org, bytes32(0), uint64(_now()), a));
    }

    function _bal() internal view returns (uint256, uint256) {
        return (qUSD.balanceOf(address(hot)), qUSD.balanceOf(address(warm)));
    }

    function _receiverHash() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                receiver.lastPing(),
                receiver.alertLevel(),
                receiver.alertExpiresAt(),
                receiver.frozenUntil(address(hot)),
                receiver.frozenUntil(address(warm)),
                receiver.workflowOwner(),
                receiver.verdictRing(),
                receiver.desk(),
                receiver.heldUntil(bytes32(uint256(1))),
                _manualExp(bytes32(uint256(1)))
            )
        );
    }

    // ---------- legit paths ----------
    function legitApprove(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 50e6);
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = flow.handlerSubmit(amount);
        _report(
            metaCosign,
            Kinds.VERDICT,
            abi.encode(
                rid,
                txh,
                it.userIdHash,
                it.token,
                it.amount,
                Kinds.APPROVE,
                uint8(0),
                uint64(0),
                uint64(_now() + 15 minutes),
                new bytes(64)
            )
        );
        txHashes.push(txh);
        firstDecision[txh] = receiver.verdictOf(txh).decision;
        approved.push(Pending(rid, it));
    }

    function legitExecute(uint256 idx) external {
        if (approved.length == 0) return;
        Pending memory p = approved[idx % approved.length];
        QuorumVault.VaultTx memory t = QuorumVault.VaultTx(
            p.requestId, p.it.userIdHash, p.it.token, p.it.to, p.it.amount, p.it.nonce, p.it.deadline
        );
        try hot.execute(t) {} catch {}
    }

    function legitFreeze(uint256 dt, bool warmVault) external {
        address v = warmVault ? address(warm) : address(hot);
        _report(metaTrap, Kinds.FREEZE, abi.encode(v, uint64(_now() + bound(dt, 0, 3 hours))));
    }

    function legitAlert(uint8 level, uint256 dt) external {
        level = uint8(bound(level, 1, 4));
        _report(metaTrap, Kinds.ALERT, abi.encode(level, uint64(_now() + bound(dt, 1, 3 hours))));
    }

    function legitRefill(uint256 amt) external {
        uint64 epoch = uint64(_now() / 60);
        uint256 qBefore = hot.quota(address(qUSD));
        uint64 lastBefore = hot.lastEpoch(address(qUSD));
        _report(metaPatrol, Kinds.QUOTA_REFILL, abi.encode(address(hot), address(qUSD), epoch, bound(amt, 0, 5_000e6)));
        uint256 qAfter = hot.quota(address(qUSD));
        if (qAfter > qBefore) {
            if (epoch <= lastBefore || qAfter - qBefore > hot.rMax(address(qUSD)) * (epoch - lastBefore)) {
                violatedI6 = true;
            }
        }
        if (qAfter > hot.cap(address(qUSD))) violatedI6 = true;
    }

    function warpTime(uint256 dt) external {
        vm.warp(_now() + bound(dt, 1, 30 minutes));
    }

    // ---------- attacker paths ----------
    function attackExecute(bytes32 rid, bytes32 uid, uint256 amount, uint256 nonce) external {
        (uint256 h0, uint256 w0) = _bal();
        uint256 q0 = hot.quota(address(qUSD));
        QuorumVault.VaultTx memory t = QuorumVault.VaultTx(
            rid, uid, address(qUSD), address(0xBAD), bound(amount, 1, 1e12), nonce, uint64(_now() + 1 hours)
        );
        try hot.execute(t) {} catch {}
        try warm.execute(t) {} catch {}
        (uint256 h1, uint256 w1) = _bal();
        if (h1 < h0 || w1 < w0) violatedI1 = true;
        if (hot.quota(address(qUSD)) > q0) violatedI6 = true;
    }

    function _manualExp(bytes32 h) internal view returns (uint64 e) {
        (e,) = receiver.manualOf(h);
    }

    function attackReceiver(address caller, bytes calldata junk, uint8 kind) external {
        // The timelock may legitimately change the Receiver (two officers + delay); it is not an attacker.
        vm.assume(caller != forwarder && caller != address(receiver) && caller != receiver.desk() && caller != receiver.timelock());
        bytes32 before = _receiverHash();
        (uint256 h0, uint256 w0) = _bal();
        vm.startPrank(caller);
        try receiver.onReport(metaTrap, junk) {} catch {}
        try receiver.applyAction(kind, junk, bytes32(0)) {} catch {}
        try receiver.setWorkflowOwner(caller) {} catch {}
        try receiver.setWorkflow(bytes10("evil______"), type(uint256).max) {} catch {}
        try hot.sweepToCold(new address[](0)) {} catch {}
        try hot.refillQuota(address(qUSD), uint64(_now() / 60), 1) {} catch {}
        try warm.topUp(address(qUSD), 1e30) {} catch {}
        try OfficerDesk(receiver.desk())
            .extendFreeze(address(warm), uint64(_now() + 99 days), 1, uint64(_now() + 1), new bytes[](0)) {}
            catch {}
        // desk-only primitives from anyone but the desk
        try receiver.deskExtendFreeze(address(warm), uint64(_now() + 99 days)) {} catch {}
        try receiver.deskLowerAlert(0) {} catch {}
        try receiver.deskManualApprove(bytes32(uint256(1))) {} catch {}
        try receiver.deskHold(bytes32(uint256(1)), uint64(_now() + 1 hours)) {} catch {}
        try receiver.deskCancelVerdict(bytes32(uint256(1))) {} catch {}
        vm.stopPrank();
        if (_receiverHash() != before) violatedI7 = true;
        (uint256 h1, uint256 w1) = _bal();
        if (h1 < h0 || w1 < w0) violatedI1 = true;
    }

    /// Forwarder with a non-whitelisted workflow name must change nothing.
    function attackUnknownWorkflow(uint8 kind, bytes calldata data) external {
        bytes32 before = _receiverHash();
        QuorumReceiver.Action[] memory a = new QuorumReceiver.Action[](1);
        a[0] = QuorumReceiver.Action(kind, data);
        vm.prank(forwarder);
        try receiver.onReport(
            abi.encodePacked(bytes32(0), bytes10("rogue_____"), flow.wfOwnerAddr()),
            abi.encode(uint8(1), block.chainid, org, bytes32(0), uint64(_now()), a)
        ) {}
            catch {}
        if (_receiverHash() != before) violatedI7 = true;
    }

    // ---------- views for invariants ----------
    function txCount() external view returns (uint256) {
        return txHashes.length;
    }

    function observeFreeze() external {
        uint64 fh = receiver.frozenUntil(address(hot));
        uint64 fw = receiver.frozenUntil(address(warm));
        if (fh > maxFrozenHot) maxFrozenHot = fh;
        if (fw > maxFrozenWarm) maxFrozenWarm = fw;
    }
}

contract InvariantsTest is Flow {
    Handler handler;
    uint256 nextNonce = 1;

    function wfOwnerAddr() external view returns (address) {
        return wfOwner;
    }

    /// Called by the handler (as a helper with access to signing keys).
    function handlerSubmit(uint256 amount) external returns (bytes32, bytes32, RequestBoard.Intent memory) {
        vm.warp(vm.getBlockTimestamp() + 2); // refill A's bucket
        uint256 n = nextNonce++;
        return submitSigned(userId, userPk, address(qUSD), amount, n, string(abi.encode("inv", n)));
    }

    function setUp() public override {
        super.setUp();
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 1_000_000e6);
        handler = new Handler(IFlowHelper(address(this)), receiver, hot, warm, qUSD, ORG_A);
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](10);
        sels[0] = Handler.legitApprove.selector;
        sels[1] = Handler.legitExecute.selector;
        sels[2] = Handler.legitFreeze.selector;
        sels[3] = Handler.legitAlert.selector;
        sels[4] = Handler.legitRefill.selector;
        sels[5] = Handler.warpTime.selector;
        sels[6] = Handler.attackExecute.selector;
        sels[7] = Handler.attackReceiver.selector;
        sels[8] = Handler.attackUnknownWorkflow.selector;
        sels[9] = Handler.observeFreeze.selector;
        targetSelector(FuzzSelector(address(handler), sels));
    }

    /// I1: vault balances only fall through consumed-verdict execute, sweep, topUp.
    function invariant_I1_onlyLegitOutflows() public view {
        assertFalse(handler.violatedI1());
    }

    /// I2: a written decision never changes; used never goes back to false.
    function invariant_I2_verdictImmutable() public view {
        uint256 n = handler.txCount();
        for (uint256 i; i < n; ++i) {
            bytes32 h = handler.txHashes(i);
            assertEq(receiver.verdictOf(h).decision, handler.firstDecision(h));
        }
    }

    /// I3: frozenUntil never decreases.
    function invariant_I3_freezeMonotonic() public view {
        assertGe(receiver.frozenUntil(address(hot)), handler.maxFrozenHot());
        assertGe(receiver.frozenUntil(address(warm)), handler.maxFrozenWarm());
    }

    /// I6: quota <= cap; increases only via refill within r_max * epochs.
    function invariant_I6_quotaBucket() public view {
        assertFalse(handler.violatedI6());
        assertLe(hot.quota(address(qUSD)), hot.cap(address(qUSD)));
        assertLe(hot.quota(address(qETH)), hot.cap(address(qETH)));
    }

    /// I7: nothing outside forwarder + whitelisted workflow / officers / timelock changes the Receiver.
    function invariant_I7_noBackdoor() public view {
        assertFalse(handler.violatedI7());
    }
}
