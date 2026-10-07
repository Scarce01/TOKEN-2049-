// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {Flow} from "./Flow.t.sol";
import {DecoyCommit} from "../src/DecoyCommit.sol";
import {ThreatRegistry} from "../src/ThreatRegistry.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// Phase 5 contract parts: salted Merkle commitment (D12), hidden threshold (D21), encrypted score (D23, D64).
contract Phase5Test is Flow {
    // ---------- Merkle helpers (sorted pairs, same as OZ MerkleProof) ----------
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// 4-leaf tree: leaves[0] is the real decoy, others are fillers.
    function _tree(bytes32[4] memory leaves) internal pure returns (bytes32 root, bytes32[] memory proof0) {
        bytes32 l01 = _hashPair(leaves[0], leaves[1]);
        bytes32 l23 = _hashPair(leaves[2], leaves[3]);
        root = _hashPair(l01, l23);
        proof0 = new bytes32[](2);
        proof0[0] = leaves[1];
        proof0[1] = l23;
    }

    function _setup() internal returns (DecoyCommit dc, ThreatRegistry tr, bytes32 ident, bytes32 salt, bytes32[] memory proof) {
        ident = bytes32(uint256(uint160(makeAddr("decoyWallet"))));
        salt = keccak256("salt-0");
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(block.chainid, ident, salt))));
        bytes32 root;
        (root, proof) = _tree([leaf, keccak256("f1"), keccak256("f2"), keccak256("f3")]);
        bytes32[] memory orgs = new bytes32[](1);
        orgs[0] = ORG_A;
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = root;
        uint256[] memory counts = new uint256[](1);
        counts[0] = 4;
        dc = new DecoyCommit(address(timelock), orgs, roots, counts);
        tr = new ThreatRegistry(address(timelock), address(dc));
        address[] memory recs = new address[](1);
        recs[0] = address(this); // this test acts as the reporting Receiver
        tr.initialize(recs, orgs, new address[](0));
    }

    function test_merkleProofVerifies() public {
        (DecoyCommit dc,, bytes32 ident, bytes32 salt, bytes32[] memory proof) = _setup();
        assertTrue(dc.verify(ORG_A, block.chainid, ident, salt, proof));
        // one byte off: fails
        assertFalse(dc.verify(ORG_A, block.chainid, ident, bytes32(uint256(salt) ^ 1), proof));
        // another decoy address with any salt cannot be tested without its salt
        assertFalse(dc.verify(ORG_A, block.chainid, bytes32(uint256(uint160(makeAddr("other")))), salt, proof));
    }

    function test_leafCountPowerOfTwo() public {
        bytes32[] memory orgs = new bytes32[](1);
        orgs[0] = ORG_A;
        bytes32[] memory roots = new bytes32[](1);
        uint256[] memory counts = new uint256[](1);
        counts[0] = 6;
        vm.expectRevert(DecoyCommit.BadLeafCount.selector);
        new DecoyCommit(address(timelock), orgs, roots, counts);
    }

    function test_threatNeedsValidProof() public {
        (, ThreatRegistry tr, bytes32 ident, bytes32 salt, bytes32[] memory proof) = _setup();
        address attacker = makeAddr("attacker");
        uint64 exp = uint64(nowTs() + 72 hours);
        vm.expectRevert(ThreatRegistry.BadProof.selector);
        tr.add(attacker, uint64(block.chainid), keccak256("ev"), bytes32(0), exp, bytes32(0), ORG_A, "");
        bytes memory bad = abi.encode(ident, bytes32(uint256(salt) ^ 1), proof);
        vm.expectRevert(ThreatRegistry.BadProof.selector);
        tr.add(attacker, uint64(block.chainid), keccak256("ev"), bytes32(0), exp, bytes32(0), ORG_A, bad);
        tr.add(attacker, uint64(block.chainid), keccak256("ev"), bytes32(0), exp, bytes32(0), ORG_A, abi.encode(ident, salt, proof));
        assertTrue(tr.isSuspect(attacker));
    }

    function test_derivedNeedsLiveParent() public {
        (, ThreatRegistry tr, bytes32 ident, bytes32 salt, bytes32[] memory proof) = _setup();
        uint64 exp = uint64(nowTs() + 1 hours);
        tr.add(makeAddr("attacker"), uint64(block.chainid), keccak256("parent"), bytes32(0), exp, bytes32(0), ORG_A, abi.encode(ident, salt, proof));
        // derived entry: no proof needed while the parent is alive
        tr.add(makeAddr("hop1"), uint64(block.chainid), keccak256("child"), bytes32(0), exp, keccak256("parent"), ORG_A, "");
        assertTrue(tr.isSuspect(makeAddr("hop1")));
        vm.warp(nowTs() + 1 hours + 1);
        assertFalse(tr.isSuspect(makeAddr("hop1")));
        vm.expectRevert(ThreatRegistry.ParentInvalid.selector);
        tr.add(makeAddr("hop2"), uint64(block.chainid), keccak256("child2"), bytes32(0), uint64(nowTs() + 1 hours), keccak256("parent"), ORG_A, "");
    }

    function test_sameEvidenceDoesNotRenew() public {
        (, ThreatRegistry tr, bytes32 ident, bytes32 salt, bytes32[] memory proof) = _setup();
        address a = makeAddr("attacker");
        tr.add(a, uint64(block.chainid), keccak256("ev"), bytes32(0), uint64(nowTs() + 1 hours), bytes32(0), ORG_A, abi.encode(ident, salt, proof));
        tr.add(a, uint64(block.chainid), keccak256("ev"), bytes32(0), uint64(nowTs() + 9 hours), bytes32(0), ORG_A, abi.encode(ident, salt, proof));
        assertEq(tr.entryOf(a).expiresAt, nowTs() + 1 hours);
    }

    // ---------- hidden threshold (D21) ----------
    function test_thresholdCommitRevealViaReports() public {
        uint64 e = 7;
        uint256 thr = 2.4e18;
        bytes32 nonce = keccak256("thrnonce-7");
        bytes32 c = keccak256(abi.encode(thr, nonce));
        send(WF_PATROL, one(Kinds.THRESHOLD_COMMIT, abi.encode(e, address(qETH), c)));
        (bytes32 got,,) = decoys.thresholdOf(ORG_A, e, address(qETH));
        assertEq(got, c);
        // second commit for the same (epoch, token) is ignored
        send(WF_PATROL, one(Kinds.THRESHOLD_COMMIT, abi.encode(e, address(qETH), keccak256("other"))));
        (got,,) = decoys.thresholdOf(ORG_A, e, address(qETH));
        assertEq(got, c);
        // wrong reveal fails (ActionFailed), right reveal sticks
        vm.recordLogs();
        send(WF_PATROL, one(Kinds.THRESHOLD_REVEAL, abi.encode(e, address(qETH), thr + 1, nonce)));
        assertTrue(_emitted(QuorumReceiver.ActionFailed.selector));
        send(WF_PATROL, one(Kinds.THRESHOLD_REVEAL, abi.encode(e, address(qETH), thr, nonce)));
        (, bool revealed, uint256 t) = decoys.thresholdOf(ORG_A, e, address(qETH));
        assertTrue(revealed);
        assertEq(t, thr);
    }

    function test_onlyReceiverCommits() public {
        vm.expectRevert(DecoyCommit.NotReceiver.selector);
        decoys.commitThreshold(ORG_A, 1, address(qETH), keccak256("x"));
    }

    // ---------- encrypted score (D23, D64) ----------
    function _scoreAction(bytes32 key, bytes32 rid, bytes32 prev, bytes memory ct) internal pure returns (QuorumReceiver.Action memory) {
        return QuorumReceiver.Action(Kinds.SCORE, abi.encode(key, rid, prev, ct));
    }

    function test_scoreCompareAndSwap() public {
        bytes32 key = keccak256("score-key");
        send(WF_COSIGN, one(Kinds.SCORE, abi.encode(key, keccak256("r1"), bytes32(0), hex"aa")));
        assertEq(receiver.scoreOf(key), hex"aa");
        // prevHash must be keccak of the stored ciphertext
        send(WF_COSIGN, one(Kinds.SCORE, abi.encode(key, keccak256("r2"), keccak256(hex"aa"), hex"bb")));
        assertEq(receiver.scoreOf(key), hex"bb");
    }

    function test_scoreConflictSkipsVerdict() public {
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 1_000e6);
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = submitSigned(userId, userPk, address(qUSD), 1e6, 1, "s1");
        bytes32 key = keccak256("score-key");
        send(WF_COSIGN, one(Kinds.SCORE, abi.encode(key, keccak256("other"), bytes32(0), hex"aa")));
        // this report read an old score (prevHash 0): conflict, verdict skipped
        QuorumReceiver.Action[] memory a = new QuorumReceiver.Action[](2);
        a[0] = _scoreAction(key, rid, bytes32(0), hex"cc");
        a[1] = verdictAction(rid, txh, it, Kinds.APPROVE)[0];
        vm.recordLogs();
        send(WF_COSIGN, a);
        assertTrue(_emitted(QuorumReceiver.ScoreConflict.selector));
        assertEq(receiver.verdictOf(txh).decision, Kinds.NONE);
        assertEq(receiver.scoreOf(key), hex"aa");
    }

    function test_scoreRerunIsQuiet() public {
        bytes32 key = keccak256("score-key");
        send(WF_COSIGN, one(Kinds.SCORE, abi.encode(key, keccak256("r1"), bytes32(0), hex"aa")));
        vm.recordLogs();
        send(WF_COSIGN, one(Kinds.SCORE, abi.encode(key, keccak256("r1"), bytes32(0), hex"aa")));
        assertFalse(_emitted(QuorumReceiver.ScoreConflict.selector));
    }

    function test_verdictBeforeScoreSkipsBothButTightens() public {
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 1_000e6);
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = submitSigned(userId, userPk, address(qUSD), 1e6, 1, "s2");
        QuorumReceiver.Action[] memory a = new QuorumReceiver.Action[](3);
        a[0] = QuorumReceiver.Action(Kinds.FREEZE, abi.encode(address(warm), uint64(nowTs() + 1 hours)));
        a[1] = verdictAction(rid, txh, it, Kinds.PENDING)[0];
        a[2] = _scoreAction(keccak256("k"), rid, bytes32(0), hex"aa");
        send(WF_COSIGN, a);
        assertTrue(receiver.isFrozen(address(warm)));
        assertEq(receiver.verdictOf(txh).decision, Kinds.NONE);
        assertEq(receiver.scoreOf(keccak256("k")).length, 0);
    }

    function _emitted(bytes32 sig) internal returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) if (logs[i].topics[0] == sig) return true;
        return false;
    }
}
