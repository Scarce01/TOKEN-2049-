// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Flow} from "./Flow.t.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// docs/47 R7: during a confirmed freeze, a thin protected lane still pays a mature recipient a small amount
/// from a separate budget R; everything else stays blocked. Off until a timelock enables it.
contract ProtectedLaneTest is Flow {
    uint64 constant MATURE = 1 hours;
    uint256 constant SMALL = 100e6; // 100 qUSD
    uint256 constant RCAP = 300e6;

    function _enableLane() internal {
        vm.prank(address(timelock));
        hot.setProtectedLane(address(qUSD), SMALL, RCAP, 10e6, RCAP, MATURE); // reserve <= cap (audit 2026-10-07)
    }

    /// Pay `to` once so it becomes a seen recipient, then age it past MATURE.
    function _makeMature(address to, uint256 nonce, string memory tag) internal {
        (bytes32 rid,, RequestBoard.Intent memory it) = _approvedTo(to, 10e6, nonce, tag);
        hot.execute(vaultTx(rid, it));
        vm.warp(nowTs() + MATURE + 1);
    }

    function _approvedTo(address to, uint256 amount, uint256 nonce, string memory tag)
        internal
        returns (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it)
    {
        if (keys.keyOf(userId) == address(0)) registerKey(userId, userPk);
        if (deposits.depositedOf(userId, address(qUSD)) < 10_000e6) depositFor(userId, address(qUSD), 10_000e6);
        it = RequestBoard.Intent(
            ORG_A, userId, address(hot), address(qUSD), to, amount, nonce, uint64(nowTs() + 3 hours)
        );
        rid = keccak256(abi.encode(ORG_A, keccak256(bytes(tag))));
        txh = txHashFor(address(hot), rid, it);
        bytes memory sig = signIntent(it, userPk);
        vm.prank(submitterA);
        board.submit(requestOf(rid, it, txh), it, sig);
        send(WF_COSIGN, verdictAction(rid, txh, it, Kinds.APPROVE));
    }

    function _freeze() internal {
        QuorumReceiver.Action[] memory a = new QuorumReceiver.Action[](2);
        a[0] = QuorumReceiver.Action(Kinds.FREEZE, abi.encode(address(hot), uint64(nowTs() + 2 hours)));
        a[1] = QuorumReceiver.Action(Kinds.ALERT, abi.encode(uint8(Kinds.CONFIRMED), uint64(nowTs() + 3 hours)));
        send(WF_TRAP, a);
    }

    function test_laneOffByDefaultFreezeBlocksMatureSmall() public {
        _makeMature(payee, 1, "seed");
        _freeze();
        (bytes32 rid,, RequestBoard.Intent memory it) = _approvedTo(payee, 50e6, 2, "x");
        vm.expectRevert(QuorumVault.Frozen.selector);
        hot.execute(vaultTx(rid, it));
    }

    function test_laneLetsMatureSmallThroughDuringFreeze() public {
        _enableLane();
        _makeMature(payee, 1, "seed");
        uint256 before = qUSD.balanceOf(payee);
        _freeze();
        (bytes32 rid,, RequestBoard.Intent memory it) = _approvedTo(payee, 50e6, 2, "ok");
        hot.execute(vaultTx(rid, it));
        assertEq(qUSD.balanceOf(payee), before + 50e6);
        assertEq(hot.pBudget(address(qUSD)), RCAP - 50e6);
    }

    function test_newRecipientBlockedEvenSmall() public {
        _enableLane();
        _makeMature(payee, 1, "seed"); // payee mature; fresh is not
        _freeze();
        address fresh = makeAddr("fresh");
        (bytes32 rid,, RequestBoard.Intent memory it) = _approvedTo(fresh, 50e6, 2, "new");
        vm.expectRevert(QuorumVault.Frozen.selector);
        hot.execute(vaultTx(rid, it));
    }

    function test_largeAmountBlockedInLane() public {
        _enableLane();
        _makeMature(payee, 1, "seed");
        _freeze();
        (bytes32 rid,, RequestBoard.Intent memory it) = _approvedTo(payee, SMALL + 1, 2, "big");
        vm.expectRevert(QuorumVault.Frozen.selector);
        hot.execute(vaultTx(rid, it));
    }

    function test_budgetExhaustsThenBlocks() public {
        _enableLane();
        _makeMature(payee, 1, "seed");
        _freeze();
        // RCAP = 300, three 100-qUSD releases drain it (same block: no refill)
        for (uint256 i = 2; i <= 4; i++) {
            (bytes32 rid,, RequestBoard.Intent memory it) =
                _approvedTo(payee, 100e6, i, string.concat("r", vm.toString(i)));
            hot.execute(vaultTx(rid, it));
        }
        assertEq(hot.pBudget(address(qUSD)), 0);
        (bytes32 rid2,, RequestBoard.Intent memory it2) = _approvedTo(payee, 100e6, 5, "r5");
        vm.expectRevert(QuorumVault.Frozen.selector);
        hot.execute(vaultTx(rid2, it2));
    }

    function test_budgetRefillsPerMinute() public {
        _enableLane();
        _makeMature(payee, 1, "seed");
        _freeze();
        for (uint256 i = 2; i <= 4; i++) {
            (bytes32 rid,, RequestBoard.Intent memory it) =
                _approvedTo(payee, 100e6, i, string.concat("r", vm.toString(i)));
            hot.execute(vaultTx(rid, it));
        }
        assertEq(hot.pBudget(address(qUSD)), 0);
        vm.warp(nowTs() + 5 minutes); // 5 * 10 = 50 qUSD back
        (bytes32 rid2,, RequestBoard.Intent memory it2) = _approvedTo(payee, 50e6, 5, "r5");
        hot.execute(vaultTx(rid2, it2));
    }

    function test_sweepLeavesReserve() public {
        _enableLane(); // reserve = RCAP = 300 qUSD
        uint256 bal = qUSD.balanceOf(address(hot));
        assertGt(bal, RCAP);
        QuorumReceiver.Action[] memory a = new QuorumReceiver.Action[](1);
        address[] memory toks = new address[](1);
        toks[0] = address(qUSD);
        a[0] = QuorumReceiver.Action(Kinds.SWEEP, abi.encode(address(hot), toks));
        send(WF_TRAP, a);
        assertEq(qUSD.balanceOf(address(hot)), RCAP);
    }

    // ---- audit 2026-10-07 (R7 Medium / Low) ----

    /// matureAge is per token: enabling a qETH lane with a longer age must not change the qUSD lane.
    function test_matureAgeIsPerToken() public {
        _enableLane();
        _makeMature(payee, 1, "seed"); // payee mature for qUSD at MATURE + 1
        vm.prank(address(timelock));
        hot.setProtectedLane(address(qETH), 1e17, 3e17, 1e16, 3e17, 30 days);
        assertEq(hot.matureAge(address(qUSD)), MATURE);
        assertEq(hot.matureAge(address(qETH)), 30 days);
        _freeze();
        uint256 before = qUSD.balanceOf(payee);
        (bytes32 rid,, RequestBoard.Intent memory it) = _approvedTo(payee, 50e6, 2, "pt");
        hot.execute(vaultTx(rid, it));
        assertEq(qUSD.balanceOf(payee), before + 50e6);
    }

    /// an enabled lane needs a positive matureAge, otherwise a never-paid address would count as mature.
    function test_enabledLaneRejectsZeroMatureAge() public {
        vm.prank(address(timelock));
        vm.expectRevert(QuorumVault.BadLane.selector);
        hot.setProtectedLane(address(qUSD), SMALL, RCAP, 10e6, 0, 0);
    }

    /// the reserve exists only to fund the lane: at most the cap, and none while the lane is off.
    function test_reserveBoundedByCapAndOffWhenLaneOff() public {
        vm.startPrank(address(timelock));
        vm.expectRevert(QuorumVault.BadLane.selector);
        hot.setProtectedLane(address(qUSD), SMALL, RCAP, 10e6, RCAP + 1, MATURE);
        vm.expectRevert(QuorumVault.BadLane.selector);
        hot.setProtectedLane(address(qUSD), 0, 0, 0, 1_000e6, 0);
        hot.setProtectedLane(address(qUSD), 0, 0, 0, 0, 0); // turning the lane off stays allowed
        vm.stopPrank();
    }

    /// a recipient the user never paid is not mature, whatever matureAge is (seenAt read before consumeVerdict).
    function test_neverPaidRecipientNotMatureEvenAfterLongWait() public {
        vm.prank(address(timelock));
        hot.setProtectedLane(address(qUSD), SMALL, RCAP, 10e6, 0, 1);
        _makeMature(payee, 1, "seed"); // some unrelated recipient got paid
        _freeze();
        address fresh = makeAddr("fresh2");
        (bytes32 rid,, RequestBoard.Intent memory it) = _approvedTo(fresh, 50e6, 2, "never");
        vm.expectRevert(QuorumVault.Frozen.selector);
        hot.execute(vaultTx(rid, it));
    }

    function test_manualStillBlockedByFreeze() public {
        // a two-officer manual approval does not bypass a hard freeze (unchanged behavior)
        RequestBoard.Intent memory it =
            RequestBoard.Intent(ORG_A, userId, address(hot), address(qUSD), payee, 50e6, 1, uint64(nowTs() + 3 hours));
        bytes32 rid = keccak256(abi.encode(ORG_A, keccak256("m")));
        bytes32 txh = txHashFor(address(hot), rid, it);
        _enableLane();
        _freeze();
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 id =
            desk.queueManual(txh, 7, dl, officerSigs(address(desk), Kinds.OA_MANUAL_APPROVE, txh, 0, 7, dl, two()));
        vm.warp(nowTs() + MANUAL_DELAY);
        desk.executeManual(id);
        vm.expectRevert(QuorumVault.Frozen.selector);
        hot.execute(vaultTx(rid, it));
    }
}
