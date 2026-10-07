// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Flow} from "./Flow.t.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {MinuteRing} from "../src/lib/MinuteRing.sol";

contract BoardTest is Flow {
    function test_submitRecordsFacts() public {
        registerKey(userId, userPk);
        (bytes32 rid, bytes32 txh,) = submitSigned(userId, userPk, address(qUSD), 1e6, 1, "r1");
        assertEq(board.txHashOf(rid), txh);
        assertEq(board.signerOf(rid), userKey);
        assertEq(board.submittedAt(rid), nowTs());
        uint256[32] memory ring = board.reqRing(ORG_A);
        uint256 w = ring[(nowTs() / 60) % 32];
        assertEq(MinuteRing.minuteOf(w), nowTs() / 60);
        assertEq(MinuteRing.valueOf(w), 1);
    }

    function test_badSignatureRecordsZeroSigner() public {
        RequestBoard.Intent memory it = intentOf(userId, address(qUSD), payee, 1e6, 1);
        bytes32 rid = keccak256("bad");
        vm.prank(submitterA);
        board.submit(requestOf(rid, it, bytes32(uint256(1))), it, hex"1234");
        assertEq(board.signerOf(rid), address(0));
    }

    function test_onlySubmitterOfOrg() public {
        RequestBoard.Intent memory it = intentOf(userId, address(qUSD), payee, 1e6, 1);
        vm.expectRevert(RequestBoard.NotSubmitter.selector);
        board.submit(requestOf(keccak256("x"), it, 0), it, "");
        vm.prank(submitterB);
        vm.expectRevert(RequestBoard.WrongOrg.selector);
        board.submit(requestOf(keccak256("x"), it, 0), it, "");
    }

    function test_duplicateRequestIdAndNonceRejected() public {
        (bytes32 rid,, RequestBoard.Intent memory it) = submitSigned(userId, userPk, address(qUSD), 1e6, 1, "r1");
        bytes memory sig = signIntent(it, userPk);
        vm.prank(submitterA);
        vm.expectRevert(RequestBoard.RequestIdUsed.selector);
        board.submit(requestOf(rid, it, 0), it, sig);
        vm.prank(submitterA);
        vm.expectRevert(RequestBoard.IntentNonceUsed.selector);
        board.submit(requestOf(keccak256("other"), it, 0), it, sig);
    }

    /// D62: org A's bucket runs out; org B is unaffected.
    function test_bucketPerOrg() public {
        for (uint256 i; i < 5; ++i) {
            submitSigned(userId, userPk, address(qUSD), 1e6, 100 + i, string(abi.encode(i)));
        }
        RequestBoard.Intent memory it = intentOf(userId, address(qUSD), payee, 1e6, 999);
        bytes memory sig = signIntent(it, userPk);
        vm.prank(submitterA);
        vm.expectRevert(RequestBoard.SubmitRateLimited.selector);
        board.submit(requestOf(keccak256("over"), it, 0), it, sig);

        RequestBoard.Intent memory itB = intentOf(userId, address(qUSD), payee, 1e6, 1000);
        itB.orgId = ORG_B;
        RequestBoard.Request memory rB = requestOf(keccak256("b1"), itB, 0);
        bytes memory sigB = signIntent(itB, userPk);
        vm.prank(submitterB);
        board.submit(rB, itB, sigB);

        // refill: 1.2s per token for A
        vm.warp(nowTs() + 2);
        vm.prank(submitterA);
        board.submit(requestOf(keccak256("over"), it, 0), it, sig);
    }

    function test_resubmitRules() public {
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) =
            submitSigned(userId, userPk, address(qUSD), 1e6, 1, "r1");
        bytes memory sig = signIntent(it, userPk);
        RequestBoard.Request memory req = requestOf(rid, it, txh);
        vm.prank(submitterA);
        vm.expectRevert(RequestBoard.TooEarly.selector);
        board.resubmit(req, it, sig);

        vm.warp(nowTs() + RESUBMIT_AFTER);
        RequestBoard.Request memory tampered = requestOf(rid, it, txh);
        tampered.amount = 2e6;
        vm.prank(submitterA);
        vm.expectRevert(RequestBoard.ContentMismatch.selector);
        board.resubmit(tampered, it, sig);

        vm.prank(submitterA);
        board.resubmit(req, it, sig);
        assertEq(board.lastSentAt(rid), nowTs());
        vm.prank(submitterA);
        vm.expectRevert(RequestBoard.TooEarly.selector);
        board.resubmit(req, it, sig);
    }

    function test_setSubmitterOnlyTimelock() public {
        vm.expectRevert(RequestBoard.NotTimelock.selector);
        board.setSubmitter(address(this), ORG_A);
    }

    /// Shared vector with packages/shared (viem hashTypedData): fixed chain, address and fields.
    function test_intentDigestVector() public {
        vm.chainId(84532);
        address fixedAddr = 0x00000000000000000000000000000000000B0a2d;
        deployCodeTo(
            "RequestBoard.sol:RequestBoard",
            abi.encode(address(1), uint64(120), new bytes32[](0), new uint128[](0), new uint64[](0), new address[](0), new bytes32[](0)),
            fixedAddr
        );
        RequestBoard.Intent memory it = RequestBoard.Intent(
            keccak256("exchange-a"),
            keccak256("user"),
            0x000000000000000000000000000000000000dEaD,
            0x000000000000000000000000000000000000bEEF,
            0x000000000000000000000000000000000000cafE,
            1_000_000,
            7,
            1_900_000_000
        );
        assertEq(RequestBoard(fixedAddr).intentDigest(it), VECTOR_INTENT_DIGEST);
    }

    bytes32 constant VECTOR_INTENT_DIGEST = 0x943e2e15c64f94742a5478f409efff84e6cf6caee1c67e72a7a91df5c3a1d6ba;
}
