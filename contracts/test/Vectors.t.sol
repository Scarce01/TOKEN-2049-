// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployBase} from "../script/Deploy.s.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {ConfigTimelock} from "../src/ConfigTimelock.sol";
import {DecoyCommit} from "../src/DecoyCommit.sol";

/// Shared vectors with packages/shared/test/vectors.ts (viem side).
contract VectorsTest is Test, DeployBase {
    address constant AT = 0x000000000000000000000000000000000000dEaD;

    function test_txHashVector() public {
        vm.chainId(84532);
        address[] memory none = new address[](0);
        uint256[] memory z = new uint256[](0);
        deployCodeTo(
            "QuorumVault.sol:QuorumVault",
            abi.encode(
                QuorumVault.Config(address(1), address(2), address(0), address(3), true, 60, none, z, z, z, z, z)
            ),
            AT
        );
        QuorumVault.VaultTx memory t = QuorumVault.VaultTx(
            keccak256("req"),
            keccak256("user"),
            0x000000000000000000000000000000000000bEEF,
            0x000000000000000000000000000000000000cafE,
            1_000_000,
            7,
            1_900_000_000
        );
        assertEq(
            QuorumVault(payable(AT)).txHashOf(t), 0xd387d1d55bfb32860505351058d13d443189c3c1eeea3bdde57c3184bacf7f9b
        );
    }

    function test_officerDigestVector() public {
        vm.chainId(84532);
        deployCodeTo("ConfigTimelock.sol:ConfigTimelock", abi.encode(address(1), uint64(600)), AT);
        assertEq(
            ConfigTimelock(AT).officerDigest(1, keccak256("s"), 5, 1, 1_900_000_000),
            0xb8c1010e2f6b74fff9c31057bb100a9e5d0a52de2c62f3db41eb0d90725e7e22
        );
    }

    function test_workflowNameVector() public pure {
        assertEq(bytes32(encodeWorkflowName("quorum-trap")), bytes32(bytes10(0x31356534333232623363)));
    }

    function test_cancelDigestVector() public {
        vm.chainId(84532);
        deployCodeTo(
            "QuorumReceiver.sol:QuorumReceiver",
            abi.encode(
                QuorumReceiver.Config({
                    forwarder: address(1),
                    mode: 1,
                    simOperator: address(2),
                    orgId: bytes32(0),
                    timelock: address(3),
                    requestBoard: address(4),
                    keyRegistry: address(5),
                    depositVault: address(6),
                    reportMaxAge: 600,
                    verdictTtl: 900,
                    manualDelay: 600,
                    workflowOwner: address(7),
                    workflowNames: new bytes10[](0),
                    kindMasks: new uint256[](0),
                    largeNewDelay: 3600,
                    holdMax: 6 hours,
                    largeNewTokens: new address[](0),
                    largeNewMins: new uint256[](0),
                    passkeyNewDelay: 600
                })
            ),
            AT
        );
        assertEq(
            QuorumReceiver(AT).cancelDigest(keccak256("tx"), 1_900_000_000),
            0x44f78c1aae7f6842b468e73c387ed9daa8f2ec8837ab9f96cb7154396c6ba852
        );
    }

    function test_decoyLeafVector() public {
        DecoyCommit dc = new DecoyCommit(address(1), new bytes32[](0), new bytes32[](0), new uint256[](0));
        assertEq(
            dc.leafOf(84532, keccak256("ident"), keccak256("salt")),
            0xdc1df0a47fdb3d4d6b4ef5f1aa160c9d4a772c7e48e582e11ae3a728589a0d03
        );
    }
}
