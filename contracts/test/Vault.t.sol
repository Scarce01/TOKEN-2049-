// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Flow} from "./Flow.t.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {MinuteRing} from "../src/lib/MinuteRing.sol";
import {Kinds} from "../src/lib/Kinds.sol";

contract VaultTest is Flow {
    function test_txHashBindsRequestIdAndUser() public view {
        RequestBoard.Intent memory it = intentOf(userId, address(qUSD), payee, 1e6, 1);
        QuorumVault.VaultTx memory t = vaultTx(keccak256("r"), it);
        bytes32 h = hot.txHashOf(t);
        assertEq(h, txHashFor(address(hot), keccak256("r"), it));
        t.requestId = bytes32(uint256(keccak256("r")) ^ 1);
        assertTrue(hot.txHashOf(t) != h);
        t.requestId = keccak256("r");
        t.userIdHash = bytes32(uint256(userId) ^ (1 << 255));
        assertTrue(hot.txHashOf(t) != h);
        // same tx on another vault gives another hash
        assertTrue(warm.txHashOf(vaultTx(keccak256("r"), it)) != h);
    }

    function test_executeHappyPath() public {
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = approvedWithdrawal(100e6, 1, "w1");
        uint256 q0 = hot.quota(address(qUSD));
        hot.execute(vaultTx(rid, it));
        assertEq(qUSD.balanceOf(payee), 100e6);
        assertEq(hot.quota(address(qUSD)), q0 - 100e6);
        assertTrue(receiver.verdictOf(txh).used);
        assertTrue(receiver.seenRecipient(userId, payee));
    }

    /// D42: an L1 APPROVE with notBefore cannot be executed early, and works once the delay passes.
    function test_executeRespectsNotBefore() public {
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 10_000e6);
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) =
            submitSigned(userId, userPk, address(qUSD), 100e6, 1, "nb");
        uint64 nb = uint64(nowTs() + 30 minutes);
        send(
            WF_COSIGN,
            one(
                Kinds.VERDICT,
                abi.encode(
                    rid,
                    txh,
                    it.userIdHash,
                    it.token,
                    it.amount,
                    Kinds.APPROVE,
                    uint8(0),
                    nb,
                    uint64(nowTs() + 2 hours),
                    new bytes(64)
                )
            )
        );
        vm.expectRevert(QuorumVault.NotYetValid.selector);
        hot.execute(vaultTx(rid, it));
        vm.warp(nb);
        hot.execute(vaultTx(rid, it));
        assertEq(qUSD.balanceOf(payee), 100e6);
    }

    function test_noVerdictReverts() public {
        RequestBoard.Intent memory it = intentOf(userId, address(qUSD), payee, 100e6, 1);
        vm.expectRevert(QuorumReceiver.NoVerdict.selector);
        hot.execute(vaultTx(keccak256("x"), it));
    }

    function test_tamperedTxNoVerdict() public {
        (bytes32 rid,, RequestBoard.Intent memory it) = approvedWithdrawal(100e6, 1, "w1");
        it.to = makeAddr("attacker");
        vm.expectRevert(QuorumReceiver.NoVerdict.selector);
        hot.execute(vaultTx(rid, it));
    }

    /// D63: same (userIdHash, nonce) cannot pay twice, even under a new requestId.
    function test_userNoncePaysOnce() public {
        (bytes32 rid,, RequestBoard.Intent memory it) = approvedWithdrawal(100e6, 1, "w1");
        hot.execute(vaultTx(rid, it));
        vm.expectRevert(QuorumVault.AlreadyPaid.selector);
        hot.execute(vaultTx(rid, it));
        vm.expectRevert(QuorumVault.AlreadyPaid.selector);
        hot.execute(vaultTx(keccak256("other-request"), it));
    }

    function test_quotaExceeded() public {
        (bytes32 rid,, RequestBoard.Intent memory it) = approvedWithdrawal(6_000e6, 1, "big");
        vm.expectRevert(QuorumVault.QuotaExceeded.selector);
        hot.execute(vaultTx(rid, it));
    }

    function test_outRingAcrossMinutes() public {
        uint256 t0 = nowTs();
        (bytes32 r1,, RequestBoard.Intent memory i1) = approvedWithdrawal(10e6, 1, "a");
        hot.execute(vaultTx(r1, i1));
        (bytes32 r2,, RequestBoard.Intent memory i2) = approvedWithdrawal(5e6, 2, "b");
        hot.execute(vaultTx(r2, i2));
        uint256[32] memory ring = hot.outRing(address(qUSD));
        assertEq(MinuteRing.valueOf(ring[(t0 / 60) % 32]), 15e6);

        // 32 minutes later the same slot is overwritten
        vm.warp(t0 + 32 * 60);
        (bytes32 r3,, RequestBoard.Intent memory i3) = approvedWithdrawal(7e6, 3, "c");
        hot.execute(vaultTx(r3, i3));
        ring = hot.outRing(address(qUSD));
        uint256 w = ring[((t0 + 32 * 60) / 60) % 32];
        assertEq(MinuteRing.minuteOf(w), (t0 + 32 * 60) / 60);
        assertEq(MinuteRing.valueOf(w), 7e6);
    }

    function test_outStatsAndFund() public {
        (uint256 c0, uint256 out0, uint256 f0) = hot.outStats(address(qUSD));
        assertEq(c0, 0);
        assertEq(out0, 0);
        assertEq(f0, 10_000e6);
        // direct transfer is not counted as funded
        faucet.drip(address(qUSD), address(this), 1e6);
        qUSD.transfer(address(hot), 1e6);
        (,, uint256 f1) = hot.outStats(address(qUSD));
        assertEq(f1, f0);
        (bytes32 rid,, RequestBoard.Intent memory it) = approvedWithdrawal(10e6, 1, "a");
        hot.execute(vaultTx(rid, it));
        (uint256 c2, uint256 out2,) = hot.outStats(address(qUSD));
        assertEq(c2, 1);
        assertEq(out2, 10e6);
    }

    function test_topUpNotExternalOut() public {
        // warm tops hot up to 12,000 qUSD
        send(WF_PATROL, one(Kinds.TOPUP, abi.encode(address(warm), address(hot), address(qUSD), uint256(12_000e6))));
        assertEq(qUSD.balanceOf(address(hot)), 12_000e6);
        (, uint256 outW,) = warm.outStats(address(qUSD));
        assertEq(outW, 0);
        // idempotent
        send(WF_PATROL, one(Kinds.TOPUP, abi.encode(address(warm), address(hot), address(qUSD), uint256(12_000e6))));
        assertEq(qUSD.balanceOf(address(hot)), 12_000e6);
    }

    function test_receiverOnlyActions() public {
        vm.expectRevert(QuorumVault.NotReceiver.selector);
        hot.sweepToCold(_tokens());
        vm.expectRevert(QuorumVault.NotReceiver.selector);
        hot.zeroQuota(_tokens());
        vm.expectRevert(QuorumVault.NotReceiver.selector);
        hot.refillQuota(address(qUSD), 1, 1);
        vm.expectRevert(QuorumVault.NotReceiver.selector);
        warm.topUp(address(qUSD), 1);
        vm.expectRevert(QuorumVault.NotTimelock.selector);
        hot.setCap(address(qUSD), 1);
    }

    function test_refillRules() public {
        uint64 e0 = uint64(nowTs() / 60);
        send(WF_PATROL, one(Kinds.QUOTA_ZERO, abi.encode(address(hot), _tokens())));
        vm.warp(nowTs() + 3 * 60);
        // 3 epochs skipped: up to 3 * r_max
        send(WF_PATROL, one(Kinds.QUOTA_REFILL, abi.encode(address(hot), address(qUSD), e0 + 3, uint256(3_000e6))));
        assertEq(hot.quota(address(qUSD)), 3_000e6);
        // same epoch again rejected
        send(WF_PATROL, one(Kinds.QUOTA_REFILL, abi.encode(address(hot), address(qUSD), e0 + 3, uint256(1e6))));
        assertEq(hot.quota(address(qUSD)), 3_000e6);
        // over rate rejected
        vm.warp(nowTs() + 60);
        send(WF_PATROL, one(Kinds.QUOTA_REFILL, abi.encode(address(hot), address(qUSD), e0 + 4, uint256(1_001e6))));
        assertEq(hot.quota(address(qUSD)), 3_000e6);
        // future epoch rejected
        send(WF_PATROL, one(Kinds.QUOTA_REFILL, abi.encode(address(hot), address(qUSD), e0 + 9, uint256(1e6))));
        assertEq(hot.quota(address(qUSD)), 3_000e6);
    }

    /// D10 on-chain backstop: no refill or topUp at CONFIRMED or when frozen.
    function test_noLooseningWhenConfirmedOrFrozen() public {
        uint64 e0 = uint64(nowTs() / 60);
        send(WF_PATROL, one(Kinds.QUOTA_ZERO, abi.encode(address(hot), _tokens())));
        send(WF_TRAP, one(Kinds.ALERT, abi.encode(uint8(4), uint64(nowTs() + 1 hours))));
        vm.warp(nowTs() + 60);
        vm.expectRevert(QuorumVault.AlertConfirmed.selector);
        vm.prank(address(receiver));
        hot.refillQuota(address(qUSD), e0 + 1, 1e6);
        vm.expectRevert(QuorumVault.AlertConfirmed.selector);
        vm.prank(address(receiver));
        warm.topUp(address(qUSD), 20_000e6);

        vm.warp(nowTs() + 1 hours);
        send(WF_TRAP, one(Kinds.FREEZE, abi.encode(address(hot), uint64(nowTs() + 1 hours))));
        vm.expectRevert(QuorumVault.Frozen.selector);
        vm.prank(address(receiver));
        hot.refillQuota(address(qUSD), e0 + 2, 1e6);
        vm.expectRevert(QuorumVault.Frozen.selector);
        vm.prank(address(receiver));
        warm.topUp(address(qUSD), 20_000e6);
    }
}
