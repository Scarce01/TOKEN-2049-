// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OfficerSet} from "../src/OfficerSet.sol";
import {ConfigTimelock} from "../src/ConfigTimelock.sol";
import {Faucet} from "../src/test-tokens/Faucet.sol";
import {MockV3Aggregator} from "../src/test-tokens/MockV3Aggregator.sol";
import {DepositVault} from "../src/DepositVault.sol";
import {KeyRegistry} from "../src/KeyRegistry.sol";
import {RequestBoard} from "../src/RequestBoard.sol";
import {QuorumReceiver} from "../src/QuorumReceiver.sol";
import {OfficerDesk} from "../src/OfficerDesk.sol";
import {QuorumVault} from "../src/QuorumVault.sol";
import {ColdVault} from "../src/ColdVault.sol";
import {ThreatRegistry} from "../src/ThreatRegistry.sol";
import {QuorumLens, IPriceFeed} from "../src/QuorumLens.sol";
import {DecoyCommit} from "../src/DecoyCommit.sol";
import {PatrolState} from "../src/PatrolState.sol";
import {Kinds} from "../src/lib/Kinds.sol";

/// Shared deployment logic for Deploy (fresh) and ResetDemo (redeploys only what tightening
/// actions change). Parameters come from env; defaults follow 10_interfaces.md section 7.
abstract contract DeployBase is Script {
    bytes32 constant ORG_A = keccak256("exchange-a");
    bytes32 constant ORG_B = keccak256("exchange-b");

    struct Core {
        address officers;
        address timelock;
        address faucet;
        address qUSD;
        address qETH;
        address priceFeed;
        address deposits;
        address keys;
        address board;
    }

    struct OrgSet {
        address receiver;
        address hot;
        address warm;
        address cold;
        address desk;
        uint256 block_;
    }

    function _mode() internal view returns (uint8) {
        return keccak256(bytes(vm.envOr("RECEIVER_MODE", string("SIM")))) == keccak256("PROD") ? 0 : 1;
    }

    function _forwarder() internal view returns (address) {
        // Defaults from docs; confirm with `cre workflow supported-chains` (31_phase1.md 1.4).
        return _mode() == 0
            ? vm.envOr("FORWARDER", 0xF8344CFd5c43616a4366C34E3EEE75af79a74482)
            : vm.envOr("FORWARDER", 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5);
    }

    /// bytes10 as it appears in report metadata: ASCII of the first 10 hex chars of sha256(name).
    function encodeWorkflowName(string memory name) internal pure returns (bytes10 out) {
        bytes32 h = sha256(bytes(name));
        bytes memory hexChars = "0123456789abcdef";
        bytes memory s = new bytes(10);
        for (uint256 i; i < 5; ++i) {
            s[2 * i] = hexChars[uint8(h[i]) >> 4];
            s[2 * i + 1] = hexChars[uint8(h[i]) & 0x0f];
        }
        assembly ("memory-safe") {
            out := mload(add(s, 32))
        }
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

    function _tokens(Core memory c) internal pure returns (address[] memory t) {
        t = new address[](2);
        t[0] = c.qUSD;
        t[1] = c.qETH;
    }

    /// docs/47 R2 L_pub per token (same order as _tokens): demo 5,000 qUSD and 4 qETH.
    function _largeNewMins() internal view returns (uint256[] memory m) {
        m = new uint256[](2);
        m[0] = vm.envOr("LARGE_NEW_MIN_QUSD", uint256(5_000e6));
        m[1] = vm.envOr("LARGE_NEW_MIN_QETH", uint256(4e18));
    }

    function _deployOrg(Core memory c, bytes32 orgId) internal returns (OrgSet memory o) {
        bytes10[] memory names = new bytes10[](3);
        names[0] = encodeWorkflowName(vm.envOr("WF_NAME_TRAP", string("quorum-trap")));
        names[1] = encodeWorkflowName(vm.envOr("WF_NAME_COSIGN", string("quorum-cosign")));
        names[2] = encodeWorkflowName(vm.envOr("WF_NAME_PATROL", string("quorum-patrol")));
        uint256[] memory masks = new uint256[](3);
        masks[0] = trapMask();
        masks[1] = cosignMask();
        masks[2] = patrolMask();

        QuorumReceiver r = new QuorumReceiver(
            QuorumReceiver.Config({
                forwarder: _forwarder(),
                mode: _mode(),
                simOperator: vm.envOr("SIM_OPERATOR", address(0)),
                orgId: orgId,
                timelock: c.timelock,
                requestBoard: c.board,
                keyRegistry: c.keys,
                depositVault: c.deposits,
                reportMaxAge: uint64(vm.envOr("REPORT_MAX_AGE", uint256(10 minutes))),
                verdictTtl: uint64(vm.envOr("VERDICT_TTL", uint256(15 minutes))),
                manualDelay: uint64(vm.envOr("MANUAL_DELAY", uint256(10 minutes))),
                workflowOwner: vm.envOr("WORKFLOW_OWNER", address(0)),
                workflowNames: names,
                kindMasks: masks,
                largeNewDelay: uint64(vm.envOr("LARGE_NEW_DELAY", uint256(1 hours))),
                holdMax: uint64(vm.envOr("HOLD_MAX", uint256(6 hours))),
                largeNewTokens: _tokens(c),
                largeNewMins: _largeNewMins(),
                passkeyNewDelay: uint64(vm.envOr("PASSKEY_NEW_DELAY", uint256(10 minutes)))
            })
        );
        ColdVault cold = new ColdVault(OfficerSet(c.officers), address(r), 24 hours, 7 days);
        address[] memory toks = _tokens(c);
        uint256[] memory hotCaps = new uint256[](2);
        hotCaps[0] = 5_000e6;
        hotCaps[1] = 2e18;
        uint256[] memory rmax = new uint256[](2);
        rmax[0] = 1_000e6;
        rmax[1] = 0.3e18;
        // docs/47 R8 hourly/daily windows: off at deploy; turned on through ConfigTimelock once sized from real data
        uint256[] memory none = new uint256[](0);
        QuorumVault hot = new QuorumVault(
            QuorumVault.Config(
                address(r), address(cold), address(0), c.timelock, true, 60, toks, hotCaps, hotCaps, rmax, none, none
            )
        );
        uint256[] memory warmCaps = new uint256[](2);
        warmCaps[0] = 50_000e6;
        warmCaps[1] = 20e18;
        QuorumVault warm = new QuorumVault(
            QuorumVault.Config(
                address(r),
                address(cold),
                address(hot),
                c.timelock,
                false,
                60,
                toks,
                warmCaps,
                warmCaps,
                rmax,
                none,
                none
            )
        );
        OfficerDesk desk = new OfficerDesk(OfficerSet(c.officers), r);
        o = OrgSet(address(r), address(hot), address(warm), address(cold), address(desk), block.number);
    }

    struct Extras {
        address decoyCommit;
        address patrolState;
    }

    function _finishOrgs(Core memory c, OrgSet memory a, OrgSet memory b)
        internal
        returns (address threats, address lens, Extras memory x)
    {
        // Decoy roots come from decoy-admin `commit` (env); empty means none yet (set later via timelock).
        bytes32[] memory rootOrgs = new bytes32[](2);
        rootOrgs[0] = ORG_A;
        rootOrgs[1] = ORG_B;
        bytes32[] memory roots = new bytes32[](2);
        roots[0] = vm.envOr("DECOY_ROOT_A", bytes32(0));
        roots[1] = vm.envOr("DECOY_ROOT_B", bytes32(0));
        uint256[] memory counts = new uint256[](2);
        counts[0] = vm.envOr("DECOY_LEAVES_A", uint256(1));
        counts[1] = vm.envOr("DECOY_LEAVES_B", uint256(1));
        DecoyCommit dc = new DecoyCommit(c.timelock, rootOrgs, roots, counts);
        PatrolState ps = new PatrolState(OfficerSet(c.officers), uint64(vm.envOr("MANUAL_DELAY", uint256(10 minutes))));
        // Phase 5 on: THREAT entries must carry a Merkle proof of a committed decoy.
        bool requireProof = vm.envOr("THREAT_REQUIRE_PROOF", false);
        ThreatRegistry tr = new ThreatRegistry(c.timelock, requireProof ? address(dc) : address(0));
        QuorumReceiver(a.receiver)
            .initialize(QuorumReceiver.Init(a.hot, a.warm, a.cold, address(tr), address(dc), address(ps), a.desk));
        QuorumReceiver(b.receiver)
            .initialize(QuorumReceiver.Init(b.hot, b.warm, b.cold, address(tr), address(dc), address(ps), b.desk));
        x = Extras(address(dc), address(ps));

        address[] memory recs = new address[](2);
        recs[0] = a.receiver;
        recs[1] = b.receiver;
        bytes32[] memory orgs = new bytes32[](2);
        orgs[0] = ORG_A;
        orgs[1] = ORG_B;
        address[] memory prot = new address[](11);
        prot[0] = a.receiver;
        prot[1] = a.hot;
        prot[2] = a.warm;
        prot[3] = a.cold;
        prot[4] = b.receiver;
        prot[5] = b.hot;
        prot[6] = b.warm;
        prot[7] = b.cold;
        prot[8] = c.board;
        prot[9] = c.deposits;
        prot[10] = c.keys;
        tr.initialize(recs, orgs, prot);
        dc.initialize(recs, orgs);
        ps.initialize(recs);

        QuorumReceiver[] memory rs = new QuorumReceiver[](2);
        rs[0] = QuorumReceiver(a.receiver);
        rs[1] = QuorumReceiver(b.receiver);
        lens = address(
            new QuorumLens(
                RequestBoard(c.board),
                KeyRegistry(c.keys),
                DepositVault(c.deposits),
                tr,
                IPriceFeed(c.priceFeed),
                PatrolState(ps),
                orgs,
                rs
            )
        );
        threats = address(tr);
    }

    function _writeJson(
        Core memory c,
        OrgSet memory a,
        OrgSet memory b,
        address threats,
        address lens,
        Extras memory x,
        uint256 startBlock
    ) internal {
        string memory k = "d";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeUint(k, "resetBlock", a.block_);
        vm.serializeString(k, "mode", _mode() == 0 ? "PROD" : "SIM");
        vm.serializeAddress(k, "forwarder", _forwarder());
        vm.serializeAddress(k, "officerSet", c.officers);
        vm.serializeAddress(k, "configTimelock", c.timelock);
        vm.serializeAddress(k, "faucet", c.faucet);
        vm.serializeAddress(k, "qUSD", c.qUSD);
        vm.serializeAddress(k, "qETH", c.qETH);
        vm.serializeAddress(k, "priceFeed", c.priceFeed);
        vm.serializeAddress(k, "depositVault", c.deposits);
        vm.serializeAddress(k, "keyRegistry", c.keys);
        vm.serializeAddress(k, "requestBoard", c.board);
        vm.serializeAddress(k, "threatRegistry", threats);
        vm.serializeAddress(k, "quorumLens", lens);
        vm.serializeAddress(k, "decoyCommit", x.decoyCommit);
        vm.serializeAddress(k, "patrolState", x.patrolState);
        vm.serializeString(k, "orgA", _orgJson("a", ORG_A, a));
        string memory out = vm.serializeString(k, "orgB", _orgJson("b", ORG_B, b));
        string memory path = string.concat("../deployments/", vm.envOr("DEPLOY_NAME", string("local")), ".json");
        vm.writeJson(out, path);
        console2.log("wrote", path);
    }

    function _orgJson(string memory k, bytes32 orgId, OrgSet memory o) internal returns (string memory) {
        vm.serializeBytes32(k, "orgId", orgId);
        vm.serializeAddress(k, "receiver", o.receiver);
        vm.serializeAddress(k, "hotVault", o.hot);
        vm.serializeAddress(k, "warmVault", o.warm);
        vm.serializeAddress(k, "desk", o.desk);
        return vm.serializeAddress(k, "coldVault", o.cold);
    }
}

function _withExtra(address[] memory t, address extra) pure returns (address[] memory out) {
    out = new address[](t.length + 1);
    for (uint256 i; i < t.length; ++i) {
        out[i] = t[i];
    }
    out[t.length] = extra;
}

/// Fresh deployment of everything. Run:
/// forge script script/Deploy.s.sol --rpc-url $RPC --broadcast [--verify]
contract Deploy is DeployBase {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address[] memory offs = new address[](3);
        offs[0] = vm.envAddress("OFFICER_1");
        offs[1] = vm.envAddress("OFFICER_2");
        offs[2] = vm.envAddress("OFFICER_3");
        uint256 startBlock = block.number;

        vm.startBroadcast(pk);
        Core memory c;
        OfficerSet officers = new OfficerSet(offs, 2);
        ConfigTimelock tl = new ConfigTimelock(officers, uint64(vm.envOr("CONFIG_DELAY", uint256(10 minutes))));
        officers.initialize(address(tl));
        c.officers = address(officers);
        c.timelock = address(tl);

        address[] memory seeders = new address[](2);
        seeders[0] = deployer;
        seeders[1] = vm.envOr("SEEDER", deployer);
        Faucet faucet = new Faucet(seeders, 1_000e6, 0.5e18, 10_000_000e6, 10_000e18);
        c.faucet = address(faucet);
        c.qUSD = address(faucet.qUSD());
        c.qETH = address(faucet.qETH());
        c.priceFeed = vm.envOr("PRICE_FEED", address(0));
        if (c.priceFeed == address(0)) c.priceFeed = address(new MockV3Aggregator(8, 3000e8));

        uint256[] memory mins = new uint256[](2);
        mins[0] = 10e6;
        mins[1] = 0.005e18;
        c.deposits = address(new DepositVault(vm.envOr("COLLECTOR_A", deployer), _tokens(c), mins));
        c.keys = address(
            new KeyRegistry(
                officers,
                DepositVault(c.deposits),
                uint64(vm.envOr("KEY_CHANGE_DELAY", uint256(10 minutes))),
                uint64(vm.envOr("RECOVERY_DELAY", uint256(7 days))) // docs/47 3.7: recovery with the new key alone
            )
        );

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
        subs[0] = vm.envAddress("SUBMITTER_A");
        subs[1] = vm.envOr("SUBMITTER_B", address(0xB0B0));
        bytes32[] memory subOrgs = new bytes32[](2);
        subOrgs[0] = ORG_A;
        subOrgs[1] = ORG_B;
        c.board = address(new RequestBoard(c.timelock, 2 minutes, orgIds, caps, refill, subs, subOrgs));

        OrgSet memory a = _deployOrg(c, ORG_A);
        OrgSet memory b = _deployOrg(c, ORG_B);
        (address threats, address lens, Extras memory x) = _finishOrgs(c, a, b);

        address[] memory targets = new address[](11);
        targets[0] = c.officers;
        targets[1] = c.timelock;
        targets[2] = c.board;
        targets[3] = threats;
        targets[4] = a.receiver;
        targets[5] = a.hot;
        targets[6] = a.warm;
        targets[7] = b.receiver;
        targets[8] = b.hot;
        targets[9] = b.warm;
        targets[10] = c.keys;
        tl.initialize(_withExtra(targets, x.decoyCommit));
        vm.stopBroadcast();

        _writeJson(c, a, b, threats, lens, x, startBlock);
    }
}

/// reset-demo: redeploy Receivers, vaults, cold, ThreatRegistry and Lens; keep tokens,
/// DepositVault, KeyRegistry, RequestBoard, ConfigTimelock (no reseeding needed).
/// The new contracts are not timelock targets (its target list is bound once); config changes
/// to them after a reset need a queued addTarget first (recorded in STATUS).
contract ResetDemo is DeployBase {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory path = string.concat("../deployments/", vm.envOr("DEPLOY_NAME", string("local")), ".json");
        string memory j = vm.readFile(path);
        Core memory c;
        c.officers = vm.parseJsonAddress(j, ".officerSet");
        c.timelock = vm.parseJsonAddress(j, ".configTimelock");
        c.faucet = vm.parseJsonAddress(j, ".faucet");
        c.qUSD = vm.parseJsonAddress(j, ".qUSD");
        c.qETH = vm.parseJsonAddress(j, ".qETH");
        c.priceFeed = vm.parseJsonAddress(j, ".priceFeed");
        c.deposits = vm.parseJsonAddress(j, ".depositVault");
        c.keys = vm.parseJsonAddress(j, ".keyRegistry");
        c.board = vm.parseJsonAddress(j, ".requestBoard");
        uint256 startBlock = vm.parseJsonUint(j, ".startBlock");

        vm.startBroadcast(pk);
        OrgSet memory a = _deployOrg(c, ORG_A);
        OrgSet memory b = _deployOrg(c, ORG_B);
        (address threats, address lens, Extras memory x) = _finishOrgs(c, a, b);
        vm.stopBroadcast();
        _writeJson(c, a, b, threats, lens, x, startBlock);
    }
}
