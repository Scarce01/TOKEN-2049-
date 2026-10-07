// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {OfficerSet} from "../src/OfficerSet.sol";
import {ConfigTimelock} from "../src/ConfigTimelock.sol";
import {Faucet} from "../src/test-tokens/Faucet.sol";
import {MockERC20} from "../src/test-tokens/MockERC20.sol";
import {DepositVault} from "../src/DepositVault.sol";
import {KeyRegistry} from "../src/KeyRegistry.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {OfficerDesk} from "../src/OfficerDesk.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {ColdVault} from "../src/ColdVault.sol";
import {ThreatRegistry} from "../src/ThreatRegistry.sol";
import {QuorumLens, IPriceFeed} from "../src/QuorumLens.sol";
import {Kinds} from "../src/lib/Kinds.sol";
import {DecoyCommit} from "../src/DecoyCommit.sol";
import {PatrolState} from "../src/PatrolState.sol";

/// Full deployment fixture. The test contract is the Forwarder. Default receiver is PROD
/// with a whitelisted owner; `simReceiver` helpers live in the tests that need them.
abstract contract Base is Test {
    bytes32 constant ORG_A = keccak256("exchange-a");
    bytes32 constant ORG_B = keccak256("exchange-b");
    bytes10 constant WF_TRAP = bytes10("trap______");
    bytes10 constant WF_COSIGN = bytes10("cosign____");
    bytes10 constant WF_PATROL = bytes10("patrol____");

    uint64 constant CONFIG_DELAY = 10 minutes;
    uint64 constant KEY_DELAY = 10 minutes;
    uint64 constant RECOVERY_DELAY = 7 days;
    uint64 constant MANUAL_DELAY = 10 minutes;
    uint64 constant VERDICT_TTL = 15 minutes;
    uint64 constant REPORT_MAX_AGE = 10 minutes;
    uint64 constant LARGE_NEW_DELAY = 1 hours;
    uint64 constant HOLD_MAX = 6 hours;
    uint64 constant PASSKEY_NEW_DELAY = 10 minutes;
    uint64 constant RESUBMIT_AFTER = 2 minutes;
    uint64 constant COLD_DELAY0 = 24 hours;
    uint64 constant COLD_MAX = 7 days;

    uint256[3] officerPks = [uint256(0xA11CE), uint256(0xB0B), uint256(0xCA4E)];
    address[3] officerAddrs;
    address wfOwner = makeAddr("workflowOwner");
    address submitterA = makeAddr("submitterA");
    address submitterB = makeAddr("submitterB");
    address collector = makeAddr("collector");
    address deployer;

    OfficerSet officers;
    ConfigTimelock timelock;
    Faucet faucet;
    MockERC20 qUSD;
    MockERC20 qETH;
    DepositVault deposits;
    KeyRegistry keys;
    RequestBoard board;
    QuorumReceiver receiver;
    OfficerDesk desk;
    QuorumVault hot;
    QuorumVault warm;
    ColdVault cold;
    ThreatRegistry threats;
    QuorumLens lens;
    DecoyCommit decoys;
    PatrolState patrol;

    function setUp() public virtual {
        vm.warp(1_760_000_000);
        _setUpRest();
    }

    function nowTs() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    function _setUpRest() internal {
        deployer = address(this);
        address[] memory offs = new address[](3);
        for (uint256 i; i < 3; ++i) {
            officerAddrs[i] = vm.addr(officerPks[i]);
            offs[i] = officerAddrs[i];
        }
        officers = new OfficerSet(offs, 2);
        timelock = new ConfigTimelock(officers, CONFIG_DELAY);
        officers.initialize(address(timelock));

        address[] memory seeders = new address[](1);
        seeders[0] = address(this);
        faucet = new Faucet(seeders, 1_000e6, 1e18, 10_000_000e6, 10_000e18);
        qUSD = faucet.qUSD();
        qETH = faucet.qETH();

        address[] memory toks = _tokens();
        uint256[] memory mins = new uint256[](2);
        mins[0] = 10e6;
        mins[1] = 0.005e18;
        deposits = new DepositVault(collector, toks, mins);
        keys = new KeyRegistry(officers, deposits, KEY_DELAY, RECOVERY_DELAY);

        bytes32[] memory orgIds = new bytes32[](2);
        orgIds[0] = ORG_A;
        orgIds[1] = ORG_B;
        uint128[] memory caps = new uint128[](2);
        caps[0] = 5;
        caps[1] = 4;
        uint64[] memory refill = new uint64[](2);
        refill[0] = 1200;
        refill[1] = 1500;
        address[] memory subs = new address[](2);
        subs[0] = submitterA;
        subs[1] = submitterB;
        bytes32[] memory subOrgs = new bytes32[](2);
        subOrgs[0] = ORG_A;
        subOrgs[1] = ORG_B;
        board = new RequestBoard(address(timelock), RESUBMIT_AFTER, orgIds, caps, refill, subs, subOrgs);

        receiver = _deployReceiver(0, address(0));
        (hot, warm, cold) = _deployVaults(receiver);
        threats = new ThreatRegistry(address(timelock), address(0));
        decoys = new DecoyCommit(address(timelock), new bytes32[](0), new bytes32[](0), new uint256[](0));
        patrol = new PatrolState(officers, MANUAL_DELAY);
        desk = new OfficerDesk(officers, receiver);
        receiver.initialize(
            QuorumReceiver.Init(
                address(hot),
                address(warm),
                address(cold),
                address(threats),
                address(decoys),
                address(patrol),
                address(desk)
            )
        );

        address[] memory recs = new address[](1);
        recs[0] = address(receiver);
        bytes32[] memory recOrgs = new bytes32[](1);
        recOrgs[0] = ORG_A;
        address[] memory prot = new address[](5);
        prot[0] = address(hot);
        prot[1] = address(warm);
        prot[2] = address(cold);
        prot[3] = address(receiver);
        prot[4] = address(board);
        threats.initialize(recs, recOrgs, prot);
        decoys.initialize(recs, recOrgs);
        patrol.initialize(recs);

        QuorumReceiver[] memory rs = new QuorumReceiver[](1);
        rs[0] = receiver;
        bytes32[] memory lensOrgs = new bytes32[](1);
        lensOrgs[0] = ORG_A;
        lens = new QuorumLens(board, keys, deposits, threats, IPriceFeed(address(0)), patrol, lensOrgs, rs);

        address[] memory targets = new address[](7);
        targets[0] = address(officers);
        targets[1] = address(receiver);
        targets[2] = address(hot);
        targets[3] = address(warm);
        targets[4] = address(board);
        targets[5] = address(threats);
        targets[6] = address(timelock);
        timelock.initialize(targets);

        _fundVaults();
    }

    // ---------- deployment helpers ----------
    function _tokens() internal view returns (address[] memory t) {
        t = new address[](2);
        t[0] = address(qUSD);
        t[1] = address(qETH);
    }

    function _deployReceiver(uint8 mode, address simOperator) internal returns (QuorumReceiver r) {
        bytes10[] memory names = new bytes10[](3);
        names[0] = WF_TRAP;
        names[1] = WF_COSIGN;
        names[2] = WF_PATROL;
        uint256[] memory masks = new uint256[](3);
        masks[0] = trapMask();
        masks[1] = cosignMask();
        masks[2] = patrolMask();
        r = new QuorumReceiver(
            QuorumReceiver.Config({
                forwarder: address(this),
                mode: mode,
                simOperator: simOperator,
                orgId: ORG_A,
                timelock: address(timelock),
                requestBoard: address(board),
                keyRegistry: address(keys),
                depositVault: address(deposits),
                reportMaxAge: REPORT_MAX_AGE,
                verdictTtl: VERDICT_TTL,
                manualDelay: MANUAL_DELAY,
                workflowOwner: wfOwner,
                workflowNames: names,
                kindMasks: masks,
                largeNewDelay: LARGE_NEW_DELAY,
                holdMax: HOLD_MAX,
                largeNewTokens: new address[](0),
                largeNewMins: new uint256[](0),
                passkeyNewDelay: PASSKEY_NEW_DELAY
            })
        );
    }

    function _deployVaults(QuorumReceiver r) internal returns (QuorumVault h, QuorumVault w, ColdVault c) {
        c = new ColdVault(officers, address(r), COLD_DELAY0, COLD_MAX);
        address[] memory toks = _tokens();
        uint256[] memory caps = new uint256[](2);
        caps[0] = 5_000e6;
        caps[1] = 2e18;
        uint256[] memory rmax = new uint256[](2);
        rmax[0] = 1_000e6;
        rmax[1] = 0.3e18;
        uint256[] memory none = new uint256[](0);
        h = new QuorumVault(
            QuorumVault.Config(
                address(r), address(c), address(0), address(timelock), true, 60, toks, caps, caps, rmax, none, none
            )
        );
        uint256[] memory wcaps = new uint256[](2);
        wcaps[0] = 50_000e6;
        wcaps[1] = 20e18;
        w = new QuorumVault(
            QuorumVault.Config(
                address(r), address(c), address(h), address(timelock), false, 60, toks, wcaps, wcaps, rmax, none, none
            )
        );
    }

    function _fundVaults() internal {
        faucet.drip(address(qUSD), address(this), 30_000e6);
        faucet.drip(address(qETH), address(this), 8e18);
        qUSD.approve(address(hot), type(uint256).max);
        qETH.approve(address(hot), type(uint256).max);
        qUSD.approve(address(warm), type(uint256).max);
        qETH.approve(address(warm), type(uint256).max);
        hot.fund(address(qUSD), 10_000e6);
        hot.fund(address(qETH), 3e18);
        warm.fund(address(qUSD), 20_000e6);
        warm.fund(address(qETH), 5e18);
    }

    function trapMask() internal pure returns (uint256) {
        return Kinds.bit(Kinds.FREEZE) | Kinds.bit(Kinds.QUOTA_ZERO) | Kinds.bit(Kinds.SWEEP) | Kinds.bit(Kinds.ALERT)
            | Kinds.bit(Kinds.COLD_DELAY) | Kinds.bit(Kinds.THREAT);
    }

    function cosignMask() internal pure returns (uint256) {
        return trapMask() | Kinds.bit(Kinds.VERDICT) | Kinds.bit(Kinds.SCORE);
    }

    function patrolMask() internal pure returns (uint256) {
        return trapMask() | Kinds.bit(Kinds.PING) | Kinds.bit(Kinds.QUOTA_REFILL) | Kinds.bit(Kinds.TOPUP)
            | Kinds.bit(Kinds.THRESHOLD_COMMIT) | Kinds.bit(Kinds.THRESHOLD_REVEAL) | Kinds.bit(Kinds.PATROL_STATE)
            | Kinds.bit(Kinds.ASSET_CHECKPOINT);
    }

    // ---------- report helpers ----------
    function meta(bytes10 name, address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(0x1d)), name, owner);
    }

    function meta64(bytes10 name, address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(0x1d)), name, owner, bytes2(0x0001));
    }

    function envelope(bytes32 caseId, QuorumReceiver.Action[] memory actions) internal view returns (bytes memory) {
        return abi.encode(uint8(1), block.chainid, ORG_A, caseId, uint64(nowTs()), actions);
    }

    function one(uint8 kind, bytes memory data) internal pure returns (QuorumReceiver.Action[] memory a) {
        a = new QuorumReceiver.Action[](1);
        a[0] = QuorumReceiver.Action(kind, data);
    }

    function send(bytes10 wf, QuorumReceiver.Action[] memory actions) internal {
        receiver.onReport(meta(wf, wfOwner), envelope(keccak256("case"), actions));
    }

    function confirmedPack(address suspect, bytes32 evidence) internal view returns (QuorumReceiver.Action[] memory a) {
        a = new QuorumReceiver.Action[](6);
        a[0] = QuorumReceiver.Action(Kinds.FREEZE, abi.encode(address(warm), uint64(nowTs() + 2 hours)));
        a[1] = QuorumReceiver.Action(Kinds.QUOTA_ZERO, abi.encode(address(hot), _tokens()));
        a[2] = QuorumReceiver.Action(Kinds.SWEEP, abi.encode(address(hot), _tokens()));
        a[3] = QuorumReceiver.Action(Kinds.ALERT, abi.encode(uint8(4), uint64(nowTs() + 2 hours)));
        a[4] = QuorumReceiver.Action(Kinds.COLD_DELAY, abi.encode(uint64(72 hours)));
        a[5] = QuorumReceiver.Action(
            Kinds.THREAT,
            abi.encode(
                suspect,
                uint64(block.chainid),
                evidence,
                keccak256("fp"),
                uint64(nowTs() + 72 hours),
                bytes32(0),
                bytes("")
            )
        );
    }

    // ---------- officer signing ----------
    /// Signs with officers at the given indexes; returns signatures sorted by signer address.
    function officerSigs(
        address target,
        uint8 kind,
        bytes32 subject,
        uint256 value,
        uint256 nonce,
        uint64 deadline,
        uint256[] memory idx
    ) internal view returns (bytes[] memory sigs) {
        bytes32 digest = _officerDigest(target, kind, subject, value, nonce, deadline);
        uint256 n = idx.length;
        address[] memory addrs = new address[](n);
        sigs = new bytes[](n);
        for (uint256 i; i < n; ++i) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(officerPks[idx[i]], digest);
            sigs[i] = abi.encodePacked(r, s, v);
            addrs[i] = officerAddrs[idx[i]];
        }
        for (uint256 i; i < n; ++i) {
            for (uint256 j = i + 1; j < n; ++j) {
                if (addrs[j] < addrs[i]) {
                    (addrs[i], addrs[j]) = (addrs[j], addrs[i]);
                    (sigs[i], sigs[j]) = (sigs[j], sigs[i]);
                }
            }
        }
    }

    function _officerDigest(address target, uint8 kind, bytes32 subject, uint256 value, uint256 nonce, uint64 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("QuorumOfficer"),
                keccak256("1"),
                block.chainid,
                target
            )
        );
        bytes32 s = keccak256(
            abi.encode(
                keccak256("OfficerAction(uint8 kind,bytes32 subject,uint256 value,uint256 nonce,uint64 deadline)"),
                kind,
                subject,
                value,
                nonce,
                deadline
            )
        );
        return keccak256(abi.encodePacked(hex"1901", domain, s));
    }

    function two() internal pure returns (uint256[] memory i) {
        i = new uint256[](2);
        i[0] = 0;
        i[1] = 1;
    }

    function single(uint256 k) internal pure returns (uint256[] memory i) {
        i = new uint256[](1);
        i[0] = k;
    }
}
