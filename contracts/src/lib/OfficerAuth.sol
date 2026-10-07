// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Eip712} from "./Eip712.sol";
import {OfficerSet} from "../OfficerSet.sol";

/// Verifies OfficerAction signatures (domain "QuorumOfficer" v1, verifyingContract = this).
/// Replay guard: each signed action digest is usable once. Signers must be distinct officers,
/// passed in strictly ascending address order (so one officer signing twice counts once).
abstract contract OfficerAuth {
    error OfficerSigExpired();
    error OfficerActionUsed();
    error NotEnoughOfficers();
    error NotOfficer();

    bytes32 internal constant OFFICER_ACTION_TYPEHASH =
        keccak256("OfficerAction(uint8 kind,bytes32 subject,uint256 value,uint256 nonce,uint64 deadline)");
    bytes32 private constant NAME_HASH = keccak256("QuorumOfficer");
    bytes32 private constant VERSION_HASH = keccak256("1");

    OfficerSet public immutable officerSet;
    mapping(bytes32 => bool) public officerActionUsed;

    constructor(OfficerSet officerSet_) {
        officerSet = officerSet_;
    }

    function officerDigest(uint8 kind, bytes32 subject, uint256 value, uint256 nonce, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(OFFICER_ACTION_TYPEHASH, kind, subject, value, nonce, deadline));
        return Eip712.digest(Eip712.domain(NAME_HASH, VERSION_HASH, address(this)), structHash);
    }

    /// needed = 0 means officerSet.threshold().
    function _consumeOfficers(
        uint8 kind,
        bytes32 subject,
        uint256 value,
        uint256 nonce,
        uint64 deadline,
        bytes[] calldata sigs,
        uint256 needed
    ) internal returns (bytes32 digest) {
        if (block.timestamp > deadline) revert OfficerSigExpired();
        digest = officerDigest(kind, subject, value, nonce, deadline);
        if (officerActionUsed[digest]) revert OfficerActionUsed();
        if (needed == 0) needed = officerSet.threshold();
        address last;
        uint256 count;
        for (uint256 i; i < sigs.length; ++i) {
            address signer = ECDSA.recover(digest, sigs[i]);
            if (!officerSet.isOfficer(signer)) revert NotOfficer();
            if (signer <= last) revert NotEnoughOfficers();
            last = signer;
            ++count;
        }
        if (count < needed) revert NotEnoughOfficers();
        officerActionUsed[digest] = true;
    }
}
