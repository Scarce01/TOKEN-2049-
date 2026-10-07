// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";

/// WebAuthn assertion check for a 32-byte challenge (docs/47 3.4, passkeys). A P-256 authenticator signs
/// sha256(authenticatorData || sha256(clientDataJSON)); clientDataJSON must carry type "webauthn.get" and
/// the base64url challenge. The public key travels with the signature, so no registry lookup is needed;
/// the signer identity is keyIdOf(qx, qy), an address-sized id that fits every existing key slot.
library WebAuthn {
    struct Auth {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeIndex; // offset of "challenge":"..." in clientDataJSON
        uint256 typeIndex; // offset of "type":"webauthn.get"
        bytes32 r;
        bytes32 s;
        bytes32 qx;
        bytes32 qy;
    }

    bytes internal constant TYPE_GET = '"type":"webauthn.get"';

    function keyIdOf(bytes32 qx, bytes32 qy) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode(qx, qy)))));
    }

    function verify(bytes32 challenge, Auth memory a) internal view returns (bool) {
        // rpIdHash(32) || flags(1) || signCount(4); flags bit 0 = user present
        if (a.authenticatorData.length < 37 || (uint8(a.authenticatorData[32]) & 0x01) == 0) return false;
        bytes memory cdj = bytes(a.clientDataJSON);
        if (!_has(cdj, a.typeIndex, TYPE_GET)) return false;
        bytes memory expected =
            bytes(string.concat('"challenge":"', Base64.encodeURL(abi.encodePacked(challenge)), '"'));
        if (!_has(cdj, a.challengeIndex, expected)) return false;
        bytes32 h = sha256(abi.encodePacked(a.authenticatorData, sha256(cdj)));
        return P256.verify(h, a.r, a.s, a.qx, a.qy);
    }

    /// Signer id for an abi-encoded Auth blob, or address(0) when it does not verify. Reverts on a
    /// malformed blob; callers that must not revert wrap it in try/catch.
    function signerOf(bytes32 challenge, bytes memory blob) internal view returns (address) {
        Auth memory a = abi.decode(blob, (Auth));
        return verify(challenge, a) ? keyIdOf(a.qx, a.qy) : address(0);
    }

    function _has(bytes memory s, uint256 at, bytes memory needle) private pure returns (bool) {
        if (at + needle.length > s.length) return false;
        for (uint256 i; i < needle.length; ++i) {
            if (s[at + i] != needle[i]) return false;
        }
        return true;
    }
}
