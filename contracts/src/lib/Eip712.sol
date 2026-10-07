// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Minimal EIP-712 helper. Contracts here verify more than one domain (KeyRegistry verifies
/// both QuorumKeys and QuorumOfficer), so we do not use OZ EIP712 which binds one domain.
library Eip712 {
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function domain(bytes32 nameHash, bytes32 versionHash, address verifying) internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, nameHash, versionHash, block.chainid, verifying));
    }

    function digest(bytes32 domainSeparator, bytes32 structHash) internal pure returns (bytes32 d) {
        assembly ("memory-safe") {
            let p := mload(0x40)
            mstore(p, hex"1901")
            mstore(add(p, 0x02), domainSeparator)
            mstore(add(p, 0x22), structHash)
            d := keccak256(p, 0x42)
        }
    }
}
