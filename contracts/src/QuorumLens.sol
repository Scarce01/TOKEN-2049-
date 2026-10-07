// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {QuorumReceiver} from "./QuorumReceiver.sol";
import {QuorumVault} from "./QuorumVault.sol";
import {RequestBoard} from "./RequestBoard.sol";
import {KeyRegistry} from "./KeyRegistry.sol";
import {DepositVault} from "./DepositVault.sol";
import {ThreatRegistry} from "./ThreatRegistry.sol";
import {PatrolState} from "./PatrolState.sol";

interface IPriceFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// Read-only aggregator: one eth_call returns everything a workflow handler needs, so each CRE
/// execution stays inside the 15 EVM read budget (10_interfaces.md section 9). No state changes.
contract QuorumLens {
    error UnknownOrg();

    struct CosignView {
        address key;
        address[] tokens;
        uint256[] deposited;
        uint256[] approved;
        uint64 firstDepositAt;
        bool seenRecipient;
        bool toIsSuspect;
        bool fingerprintActive;
        uint256 activeConfirmedCount;
        uint8 alert;
        bytes score;
        int256 priceAnswer;
        uint256 priceUpdatedAt;
    }

    struct VaultView {
        address vault;
        uint64 frozenUntil;
        bytes32 configHash;
        uint256[] balances;
        uint256[] quotas;
        uint256[] caps;
        uint64[] lastEpochs;
        uint256[] outCounts;
        uint256[] extOutTotals;
        uint256[] fundedTotals;
    }

    struct OrgView {
        bytes32 orgId;
        address receiver;
        uint8 alert;
        uint64 alertExpiresAt;
        uint64 deployedMinute;
        bytes32 lastPing;
        address[] tokens;
        uint256[32] reqRing;
        uint256[32] verdictRing;
        VaultView hot;
        VaultView warm;
        uint256[32][] hotOutRings; // per token
        uint64 coldDelay;
        PatrolState.Checkpoint[] hotCheckpoints; // per token (CUSUM)
        PatrolState.Asset[] assets; // per token (asset conservation high-water mark)
    }

    struct AddrView {
        address addr;
        uint256 native;
        uint256[] tokenBalances;
    }

    RequestBoard public immutable requestBoard;
    KeyRegistry public immutable keyRegistry;
    DepositVault public immutable depositVault;
    ThreatRegistry public immutable threatRegistry;
    IPriceFeed public immutable priceFeed;
    PatrolState public immutable patrolState;
    mapping(bytes32 => QuorumReceiver) public receiverOf;

    constructor(
        RequestBoard rb,
        KeyRegistry kr,
        DepositVault dv,
        ThreatRegistry tr,
        IPriceFeed feed,
        PatrolState ps,
        bytes32[] memory orgIds,
        QuorumReceiver[] memory receivers
    ) {
        requestBoard = rb;
        keyRegistry = kr;
        depositVault = dv;
        threatRegistry = tr;
        priceFeed = feed;
        patrolState = ps;
        for (uint256 i; i < orgIds.length; ++i) receiverOf[orgIds[i]] = receivers[i];
    }

    function cosignView(bytes32 orgId, bytes32 userIdHash, address, /* token */ address to, bytes32 fp, bytes32 scoreKey)
        external
        view
        returns (CosignView memory v)
    {
        QuorumReceiver r = _receiver(orgId);
        v.key = keyRegistry.keyOf(userIdHash);
        v.tokens = QuorumVault(payable(r.hotVault())).tokens();
        uint256 n = v.tokens.length;
        v.deposited = new uint256[](n);
        v.approved = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            v.deposited[i] = depositVault.depositedOf(userIdHash, v.tokens[i]);
            v.approved[i] = r.approvedOf(userIdHash, v.tokens[i]);
        }
        v.firstDepositAt = depositVault.firstDepositAt(userIdHash);
        v.seenRecipient = r.seenRecipient(userIdHash, to);
        v.toIsSuspect = threatRegistry.isSuspect(to);
        v.fingerprintActive = threatRegistry.fingerprintActive(fp);
        v.activeConfirmedCount = threatRegistry.activeConfirmedCount();
        v.alert = r.alert();
        v.score = r.scoreOf(scoreKey);
        if (address(priceFeed) != address(0)) {
            (, v.priceAnswer,, v.priceUpdatedAt,) = priceFeed.latestRoundData();
        }
    }

    /// Planned ops whose windowStart hour is in [fromHour, toHour] (CUSUM recompute range).
    function plannedOps(uint64 fromHour, uint64 toHour) external view returns (PatrolState.PlannedOp[] memory) {
        return patrolState.plannedOps(fromHour, toHour);
    }

    function patrolView(bytes32[] calldata orgIds, address[] calldata addrs)
        external
        view
        returns (OrgView[] memory orgs, AddrView[] memory addrViews)
    {
        orgs = new OrgView[](orgIds.length);
        address[] memory toks;
        for (uint256 i; i < orgIds.length; ++i) {
            orgs[i] = _orgView(orgIds[i]);
            toks = orgs[i].tokens;
        }
        addrViews = new AddrView[](addrs.length);
        for (uint256 i; i < addrs.length; ++i) {
            AddrView memory a;
            a.addr = addrs[i];
            a.native = addrs[i].balance;
            a.tokenBalances = new uint256[](toks.length);
            for (uint256 j; j < toks.length; ++j) {
                if (toks[j] != address(0)) a.tokenBalances[j] = IERC20(toks[j]).balanceOf(addrs[i]);
            }
            addrViews[i] = a;
        }
    }

    function _orgView(bytes32 orgId) private view returns (OrgView memory o) {
        QuorumReceiver r = _receiver(orgId);
        o.orgId = orgId;
        o.receiver = address(r);
        o.alert = r.alert();
        o.alertExpiresAt = r.alertExpiresAt();
        o.deployedMinute = r.deployedMinute();
        o.lastPing = r.lastPing();
        o.reqRing = requestBoard.reqRing(orgId);
        o.verdictRing = r.verdictRing();
        QuorumVault hot = QuorumVault(payable(r.hotVault()));
        o.tokens = hot.tokens();
        o.hot = _vaultView(r, hot, o.tokens);
        o.warm = _vaultView(r, QuorumVault(payable(r.warmVault())), o.tokens);
        o.hotOutRings = new uint256[32][](o.tokens.length);
        for (uint256 j; j < o.tokens.length; ++j) o.hotOutRings[j] = hot.outRing(o.tokens[j]);
        (bool ok, bytes memory ret) = r.coldVault().staticcall(abi.encodeWithSignature("delay()"));
        if (ok && ret.length == 32) o.coldDelay = abi.decode(ret, (uint64));
        o.hotCheckpoints = new PatrolState.Checkpoint[](o.tokens.length);
        o.assets = new PatrolState.Asset[](o.tokens.length);
        if (address(patrolState) != address(0)) {
            for (uint256 j; j < o.tokens.length; ++j) {
                (uint64 m, bool al, bool g, uint256 S) = patrolState.checkpointOf(address(hot), o.tokens[j]);
                o.hotCheckpoints[j] = PatrolState.Checkpoint(m, al, g, S);
                (uint64 sb, bool set, int256 val, bytes32 vs) = patrolState.assetOf(orgId, o.tokens[j]);
                o.assets[j] = PatrolState.Asset(sb, set, val, vs);
            }
        }
    }

    function _vaultView(QuorumReceiver r, QuorumVault vault, address[] memory toks)
        private
        view
        returns (VaultView memory v)
    {
        uint256 n = toks.length;
        v.vault = address(vault);
        v.frozenUntil = r.frozenUntil(address(vault));
        v.configHash = vault.configHash();
        v.balances = new uint256[](n);
        v.quotas = new uint256[](n);
        v.caps = new uint256[](n);
        v.lastEpochs = new uint64[](n);
        v.outCounts = new uint256[](n);
        v.extOutTotals = new uint256[](n);
        v.fundedTotals = new uint256[](n);
        for (uint256 j; j < n; ++j) {
            address t = toks[j];
            v.balances[j] = vault.balanceOf(t);
            v.quotas[j] = vault.quota(t);
            v.caps[j] = vault.cap(t);
            v.lastEpochs[j] = vault.lastEpoch(t);
            (v.outCounts[j], v.extOutTotals[j], v.fundedTotals[j]) = vault.outStats(t);
        }
    }

    function _receiver(bytes32 orgId) private view returns (QuorumReceiver r) {
        r = receiverOf[orgId];
        if (address(r) == address(0)) revert UnknownOrg();
    }
}
