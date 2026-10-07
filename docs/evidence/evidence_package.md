# 证据包（E2）：格式与验证步骤

诱饵触发后，由 Console 导出一份证据包，交给 SEAL 911、链上追踪公司、稳定币发行方的合规团队。

**它的作用：** 让对方不必信任我们，自己用公开 RPC 在几分钟内核实「这是事先埋好的诱饵，而且真的被碰了」，从而**缩短法律与人工流程的准备时间**。

**它不是：** 让发行方自动冻结的凭证。Circle 的公开立场是只在法律命令下冻结 USDC；对外文案不能暗示「交出证据包就会被冻结」。

状态：模板草稿（2026-10-05）。Console 的导出功能还没实现；字段全部对应 main 上已有的合约与 workflow，见 e1_spec_vs_repo.md。

---

## 1. 适用范围

| 触发来源 | 有没有完整证据包 | 原因 |
| --- | --- | --- |
| 诱饵钱包（ERC-20，Trap A） | 有 | 攻击者地址 + Merkle 证明都在 THREAT 里 |
| 诱饵账户（Cosign） | 有 | 同上（`decoyProof`） |
| 诱饵收款地址（Trap B） | 只有本地收紧记录 | 钱是我们付出去的，没有攻击者地址可报（`suspect = 0`） |
| 原生币诱饵（Patrol） | 只有本地收紧记录 | Patrol 只看余额下降，不知道去向（`suspect = 0`） |

后两类导出时，证据包只含第 2 节的「事件」「收紧动作」「时间线」，并注明「no attacker address」。

## 2. 格式

导出两份：`evidence_<caseId>.json`（机器验证用）和 `evidence_<caseId>.pdf`（人看的，内容相同）。JSON 结构：

```json
{
  "format": "quorum-evidence/1",
  "case": {
    "caseId": "0x…",
    "display": "Q-XXXX-XXXX",
    "exchange": "Exchange A",
    "orgId": "0x…",
    "mode": "PROD | CRE simulation",
    "exportedAt": "2026-10-07T10:00:00Z"
  },
  "chain": { "chainId": 84532, "name": "Base Sepolia", "explorer": "https://sepolia.basescan.org" },
  "contracts": {
    "decoyCommit": "0x…",
    "threatRegistry": "0x…",
    "receiver": "0x…",
    "forwarder": "0x…"
  },
  "trigger": {
    "txHash": "0x…",
    "logIndex": 3,
    "block": 123456,
    "blockTime": "2026-10-07T09:58:12Z",
    "token": "0x…",
    "from": "<decoy, see decoy.ident>",
    "to": "0x… (attacker)",
    "amount": "840000000000000000"
  },
  "decoy": {
    "kind": "wallet | account",
    "ident": "0x… (bytes32)",
    "salt": "0x…",
    "proof": ["0x…", "0x…"],
    "leaf": "0x…",
    "root": "0x…",
    "leafCount": 16,
    "rootSetTx": "0x…",
    "rootSetBlock": 120000
  },
  "threat": {
    "suspect": "0x…",
    "evidenceHash": "0x…",
    "fingerprintHash": "0x…",
    "expiresAt": "2026-10-10T09:58:12Z",
    "derived": false,
    "writeTx": "0x…",
    "writeBlock": 123460
  },
  "response": [
    { "action": "QUOTA_ZERO", "tx": "0x…", "readBack": "quota hot vault = 0 at block 123460" },
    { "action": "FREEZE warm vault", "tx": "0x…", "readBack": "frozenUntil = …" },
    { "action": "COLD_DELAY", "tx": "0x…", "readBack": "delay 24h -> 72h" }
  ],
  "onwardFlow": {
    "source": "offline, analysis/trace_bybit method",
    "hops": [{ "address": "0x…", "hop": 1, "taintPct": 100, "breakpoint": null }],
    "note": "derived from public data; not verified by the DON"
  },
  "timeline": [
    { "t": "09:58:12", "event": "decoy transfer (trigger)" },
    { "t": "09:58:40", "event": "CRE report written, tightening executed" },
    { "t": "09:58:40", "event": "ThreatRegistry entry added" }
  ]
}
```

所有地址给完整值。**诱饵的 `ident` 与 `salt` 在 THREAT 写入时已经出现在链上 calldata 里**（证明必须公开），所以证据包里给出它们不会多泄露什么；但这个诱饵从此暴露，必须退役（规格 E1 的「揭示后退役」）。同一棵树里其他叶子各有独立的盐，不受影响。

## 3. 验证步骤（给收到证据包的人）

只需要一个公开 RPC 和 Foundry 的 `cast`，不需要信任我们。下面用 `$RPC`、`$DC`（DecoyCommit）、`$TR`（ThreatRegistry）代表证据包里的值。

### 第 1 步：诱饵是事先承诺的

1. 重算叶子，必须等于 `decoy.leaf`：
   ```bash
   cast keccak $(cast keccak $(cast abi-encode "f(uint256,bytes32,bytes32)" $CHAIN_ID $IDENT $SALT))
   ```
2. 让合约验证 Merkle 证明，必须返回 `true`。查询要指定 `threat.writeBlock`，用写入当时生效的根：
   ```bash
   cast call $DC "verify(bytes32,uint256,bytes32,bytes32,bytes32[])(bool)" $ORG_ID $CHAIN_ID $IDENT $SALT "[$PROOF]" --block $WRITE_BLOCK --rpc-url $RPC
   ```
3. **时间顺序（最关键）**：这个根是在触发**之前**设的。查 `RootSet` 事件，确认 `rootSetBlock < trigger.block`，并且 `rootSetBlock` 到 `trigger.block` 之间该 org 没有新的 `RootSet`：
   ```bash
   cast logs --address $DC "RootSet(bytes32 indexed,bytes32,uint256)" $ORG_ID --from-block 0 --to-block $TRIGGER_BLOCK --rpc-url $RPC
   ```
   为什么重要：根可以经 ConfigTimelock 更换（两位人员签名，再排队 `configDelay`）。只有「触发前已经生效的根」才能证明诱饵不是事后补进去的。
4. `leafCount` 是 2 的幂，补了假叶子：叶子数不代表诱饵数，证据包不透露交易所一共埋了多少诱饵。

### 第 2 步：诱饵真的被碰了

1. 读触发交易的回执，在 `trigger.logIndex` 找到 ERC-20 `Transfer`：合约是 `trigger.token`，`from` 是诱饵（`ident` 的后 20 字节），`to` 是 `threat.suspect`，金额大于 0：
   ```bash
   cast receipt $TRIGGER_TX --rpc-url $RPC --json | jq ".logs[] | select(.logIndex == \"$(cast to-hex $LOG_INDEX)\")"
   ```
2. 重算 `evidenceHash`，必须等于证据包与链上条目里的值：
   ```bash
   cast keccak $(cast abi-encode "f(uint256,bytes32,uint256)" $CHAIN_ID $TRIGGER_TX $LOG_INDEX)
   ```
3. 诱饵钱包「只收不转」：在触发之前，它没有任何转出（用浏览器或 `cast logs` 查 `Transfer(from = 诱饵)`）。这说明这笔转出不可能是正常运营。

### 第 3 步：共享名单里确实有这条

```bash
cast call $TR "entryOf(address)((uint64,uint64,uint64,uint32,bool,bytes32,bytes32,bytes32))" $SUSPECT --rpc-url $RPC
cast call $TR "evidenceExpiresAt(bytes32)(uint64)" $EVIDENCE_HASH --rpc-url $RPC
```

确认 `derived = false`（来自诱饵证据，不是溯源推出），`expiresAt` 晚于现在，`reporterOrg` 是导出的交易所。`writeTx` 的发送方是 Forwarder，调用的是 Receiver。

### 第 4 步：收紧确实生效（可选）

对 `response` 里的每一项，在 `writeBlock` 读一次合约状态（例如金库的额度与 `frozenUntil`），不是只看交易成功（CLAUDE.md 规则 7）。

## 4. 这份证据证明了什么、没证明什么

| 证明了 | 没有证明 |
| --- | --- |
| 诱饵在触发前就承诺过（第 1 步，纯链上） | 攻击者是谁（只是一个地址） |
| 一笔从诱饵转出的交易确实发生，收款方是 `suspect`（第 2 步，任何人可查） | `suspect` 之后的资金去向（`onwardFlow` 是离线推算，标注了来源） |
| 收紧和共享名单都已在链上生效（第 3、4 步） | 方式 B（CRE 模拟）下的多节点共识；证据包 `mode` 字段要如实写 |

## 5. 给不同收件人的一句话

| 收件人 | 附言 |
| --- | --- |
| SEAL 911 | 「事先承诺的诱饵被碰，攻击者收款地址与触发交易附上，可独立验证（第 3 节），请协助协调。」 |
| 追踪公司（Chainalysis、TRM、Elliptic 等） | 「种子地址与一跳去向附上；下游请贵方接手。」 |
| 稳定币发行方合规团队 | 「供贵方准备法律流程时参考；我们理解冻结需依法律程序。」 |

## 6. 实现备注（给做 Console 的人）

- 导出所需的数据都已存在：触发交易与 logIndex 在 `traps.tripped_tx`；`proof` 在 THREAT 写入交易的 calldata；`RootSet`、`ThreatAdded`、`Tightened`、`FreezeSet` 在 ponder_quorum。
- 录屏模式下诱饵 `ident` 要打码（D29），但**导出的证据包不打码**，否则对方无法验证。导出按钮只给登录的值班人员。
- `onwardFlow` 先留空或手动附上离线溯源结果；溯源方法见 analysis/trace_bybit（PR 待开）。
