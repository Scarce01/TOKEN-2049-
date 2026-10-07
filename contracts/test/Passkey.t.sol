// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Flow} from "./Flow.t.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {WebAuthn} from "../src/lib/WebAuthn.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// docs/47 3.4: a passkey (P-256 / WebAuthn) registers, signs a withdrawal and gets paid; bad assertions give signer 0.
/// docs/47 3.6: a passkey paying a never-paid address waits at least passkeyNewDelay (blind-signing defence).
contract PasskeyTest is Flow {
    uint256 constant PK = 0x5151;
    uint256 constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    bytes32 qx;
    bytes32 qy;
    address keyId;

    function setUp() public override {
        super.setUp();
        (uint256 x, uint256 y) = vm.publicKeyP256(PK);
        qx = bytes32(x);
        qy = bytes32(y);
        keyId = WebAuthn.keyIdOf(qx, qy);
    }

    /// What an authenticator produces for `challenge`. highS forces the malleable twin (r, N - s), which the
    /// contract must reject; otherwise s is normalised to the low half like a real client does.
    function _blob(bytes32 challenge, bool highS) internal view returns (bytes memory) {
        bytes memory authData = abi.encodePacked(keccak256("rp"), bytes1(0x05), bytes4(0));
        string memory cdj = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(challenge)),
            '","origin":"https://exchange.example"}'
        );
        bytes32 h = sha256(abi.encodePacked(authData, sha256(bytes(cdj))));
        (bytes32 r, bytes32 s) = vm.signP256(PK, h);
        bool isHigh = uint256(s) > N / 2;
        if (isHigh != highS) s = bytes32(N - uint256(s));
        return abi.encode(WebAuthn.Auth(authData, cdj, 23, 1, r, s, qx, qy));
    }

    function _registerPasskey() internal {
        uint64 dl = uint64(nowTs() + 1 hours);
        bytes32 digest = keys.keyBindingDigest(userId, keyId, 1, keys.keyNonce(userId), dl);
        bytes memory blob = _blob(digest, false);
        keys.register(userId, keyId, dl, blob); // relayed by anyone: the user has no gas
        assertEq(keys.keyOf(userId), keyId);
    }

    function _submit(bytes memory sig, uint256 nonce, string memory tag)
        internal
        returns (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it)
    {
        it = intentOf(userId, address(qUSD), payee, 100e6, nonce);
        rid = keccak256(abi.encode(ORG_A, keccak256(bytes(tag))));
        txh = txHashFor(address(hot), rid, it);
        vm.prank(submitterA);
        board.submit(requestOf(rid, it, txh), it, sig);
    }

    function _passkeyWithdrawal(uint256 nonce, string memory tag)
        internal
        returns (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it)
    {
        RequestBoard.Intent memory probe = intentOf(userId, address(qUSD), payee, 100e6, nonce);
        bytes memory blob = _blob(board.intentDigest(probe), false);
        (rid, txh, it) = _submit(blob, nonce, tag);
        send(WF_COSIGN, verdictAction(rid, txh, it, Kinds.APPROVE));
    }

    function test_passkeyRegistersSignsAndGetsPaid() public {
        _registerPasskey();
        depositFor(userId, address(qUSD), 1_000e6);
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = _passkeyWithdrawal(1, "pk");
        assertEq(board.signerOf(rid), keyId);
        assertEq(board.signerKindOf(rid), 2);
        // 3.6: first payment to this address by a passkey waits passkeyNewDelay even though CRE said now
        assertEq(receiver.verdictOf(txh).notBefore, uint64(nowTs()) + PASSKEY_NEW_DELAY);
        vm.expectRevert(QuorumVault.NotYetValid.selector);
        hot.execute(vaultTx(rid, it));
        vm.warp(nowTs() + PASSKEY_NEW_DELAY);
        hot.execute(vaultTx(rid, it));
        assertEq(qUSD.balanceOf(payee), 100e6);
        // the same address again: known now, no passkey floor
        (bytes32 rid2, bytes32 txh2, RequestBoard.Intent memory it2) = _passkeyWithdrawal(2, "pk2");
        assertEq(receiver.verdictOf(txh2).notBefore, 0);
        hot.execute(vaultTx(rid2, it2));
        assertEq(qUSD.balanceOf(payee), 200e6);
    }

    function test_walletNewRecipientHasNoPasskeyFloor() public {
        (bytes32 rid, bytes32 txh, RequestBoard.Intent memory it) = approvedWithdrawal(100e6, 1, "w");
        assertEq(board.signerKindOf(rid), 1);
        assertEq(receiver.verdictOf(txh).notBefore, 0);
        hot.execute(vaultTx(rid, it));
    }

    function test_passkeyWrongChallengeGivesSignerZero() public {
        _registerPasskey();
        depositFor(userId, address(qUSD), 1_000e6);
        bytes memory blob = _blob(keccak256("another digest"), false);
        (bytes32 rid,,) = _submit(blob, 1, "pk");
        assertEq(board.signerOf(rid), address(0));
        assertEq(board.signerKindOf(rid), 0);
    }

    function test_passkeyHighSRejected() public {
        _registerPasskey();
        depositFor(userId, address(qUSD), 1_000e6);
        RequestBoard.Intent memory probe = intentOf(userId, address(qUSD), payee, 100e6, 1);
        bytes memory blob = _blob(board.intentDigest(probe), true);
        (bytes32 rid,,) = _submit(blob, 1, "pk");
        assertEq(board.signerOf(rid), address(0));
    }

    function test_malformedBlobGivesSignerZeroWithoutRevert() public {
        registerKey(userId, userPk);
        depositFor(userId, address(qUSD), 1_000e6);
        (bytes32 rid,,) = _submit(hex"deadbeef", 1, "bad");
        assertEq(board.signerOf(rid), address(0));
    }

    function test_passkeyWrongKeyIdOnRegisterRejected() public {
        uint64 dl = uint64(nowTs() + 1 hours);
        address other = makeAddr("other");
        bytes32 digest = keys.keyBindingDigest(userId, other, 1, keys.keyNonce(userId), dl);
        bytes memory blob = _blob(digest, false); // signed by our passkey, but claims to bind `other`
        vm.expectRevert();
        keys.register(userId, other, dl, blob);
    }

    /// Shared with packages/shared/test/vectors.ts p256KeyId.
    function test_keyIdVector() public pure {
        assertEq(
            WebAuthn.keyIdOf(bytes32(uint256(1)), bytes32(uint256(2))),
            address(uint160(0xeE546E97C83A08bbCCC01a0644d599cCd2A7C2E0))
        );
    }
}
