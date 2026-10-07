# E1 证据溯源规格 vs 仓库实现：差异清单

对照对象：E 的规格（quorum_jobscope_global.md 第二部分 E1，开赛前讨论稿）与 main 上的实现（2026-10-05，PR #6 之后）。

**结论：以仓库为准，改规格，不改合约。** 仓库的做法大多等价或更稳；真正影响 pitch 的差异只有三条，列在最前面。

## 影响 pitch 的三条

| # | 规格写的 | 仓库实际 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | 任何诱饵触发都写共享名单（「碰一下，全网都认得你」） | 只有**诱饵钱包**（Trap A，`workflows/trap/src/logic/decide.ts`）和**诱饵账户**（Cosign，`workflows/cosign/src/logic/build.ts`）会带上攻击者地址写 THREAT。**诱饵收款地址**（Trap B）和**原生币诱饵**（Patrol，`workflows/patrol/src/logic/decoys.ts`）触发时 `suspect = 0`，Receiver 安静跳过 THREAT | 这两类只在本交易所收紧，不进共享名单 | pitch 改成「碰到诱饵钱包或诱饵账户，全网都认得这个地址」。Trap B 本来就拿不到攻击者地址（钱是我们付出去的），是设计使然，不是 bug |
| 2 | 只有确认级证据能写共享名单 | `ThreatRegistry.add` 允许**衍生条目**（`parentEvidence ≠ 0`）不带 Merkle 证明写入，只要父条目仍有效（给链下溯源加 CRE 核实用，36_phase6.md 6.4） | 名单里可能有「由溯源推出」的地址，可信度低于诱饵证据 | 保留，但对外说明：消费方用 `entryOf(a).derived` 区分；Exchange B 对衍生条目不应升级。目前没有 workflow 会写衍生条目（路线图） |
| 3 | 五种诱饵：钱包、账户、收款地址、凭证、假门槛 | 凭证诱饵（金丝雀）**没有实现**（`services/canary` 不存在，00_overview 标 P2）。假门槛是 DecoyCommit 的门槛承诺加关 7 的 SPRT 信号，不是一个「诱饵」 | 「五种诱饵」说多了 | pitch 说「诱饵钱包、诱饵账户、诱饵收款地址，加上隐藏门槛」；凭证诱饵放路线图 |

## 逐项对照

### 1. 诱饵叶子

| 项 | 规格 | 仓库 | 判断 |
| --- | --- | --- | --- |
| 叶子 | `H(H(chainId ‖ kind ‖ identifier ‖ salt))` | `keccak256(bytes.concat(keccak256(abi.encode(chainId, ident, salt))))`（`DecoyCommit.leafOf`，`packages/shared/src/ids.ts` 的 `decoyLeaf`） | 没有 `kind`。ident 的取值域不重叠（地址补成 bytes32 vs userIdHash），实际不会撞。`abi.encode` 定长编码比拼接更不易产生歧义。**采用仓库** |
| identifier | 钱包、地址用地址；账户用 userIdHash；凭证用凭证编号哈希 | 钱包用 `bytes32(address)`；账户用 userIdHash；没有凭证 | 一致（凭证除外） |
| salt | `HMAC(K, "decoy" ‖ i)` | `HMAC-SHA256(K, "decoy" ‖ uint32_be(i))`（`decoySalt`） | 一致，仓库把 i 定成 4 字节大端 |
| 补齐 | 补到 2^k | 补随机假叶子到 2 的幂，且至少 16 片（decoy-admin `commit`）；合约拒绝非 2 的幂 | 一致，仓库更严 |
| 承诺区块高度 | 记录 | 合约不存，`RootSet` 事件自带区块号 | 等价（验证时查事件，见 evidence_package.md） |
| 双重哈希 | 防第二原像 | 有 | 一致 |

### 2. 触发规则

| 诱饵 | 规格 | 仓库 | 判断 |
| --- | --- | --- | --- |
| 诱饵钱包 | 转出方是诱饵钱包；ERC-20 由 Trap 立即、原生币由 Patrol 60 秒内 | 同左；另外 v1 起**金额为 0 的转账不算**（audit High 1） | 一致；原生币路径不写名单（见上第 1 条） |
| 诱饵收款地址 | 付款方是自家热钱包 | 付款方是自家**热或温**金库 | 仓库更全 |
| 诱饵账户 | 请求的 userIdHash 属于诱饵 | Cosign 关 4，在其他关之前检查（D14.4） | 一致 |
| 诱饵凭证 | 外部回调 | 未实现 | P2 |
| 假门槛 | 金额落在假门槛下方 10%，强信号，进 L2 | SPRT 信号 `thresholdHug`，λ = 4605；README 指出真实数据推出 λ 约 7,560（单一信号就到 L3），待团队决定 | 规格的「进 L2」与当前参数不一致，等 λ 定了再写 |

### 3. ThreatRegistry 条目（「气味证明」）

| 规格字段 | 仓库 | 判断 |
| --- | --- | --- |
| version | 无 | 合约不能升级，地址本身就是版本。不需要 |
| exchangeId | `reporterOrg` | 一致 |
| class（只允许确认级） | `derived` 布尔值；确认级 = `derived == false` | 见上第 2 条 |
| attacker、attackerChainId | `suspect`（映射键）、`chainId` | 一致 |
| trigger（chainId、txHash、logIndex、区块） | 只存 `evidenceHash = keccak256(abi.encode(chainId, txHash, logIndex))`，事件里也只有这个哈希 | 链上不能直接读出触发交易，要靠证据包给出 txHash 再重算比对。**证据包必须带 txHash 和 logIndex** |
| decoy（承诺期、叶子、盐、证明路径） | 写入时在报告 calldata 里带 `proof = abi.encode(ident, salt, path)`，合约当场验证后**不存** | 要从写入交易的 calldata 解出来；证据包直接附上 |
| fingerprint | 一个 `fingerprintHash` | 见下第 4 节 |
| createdAt、expiresAt（72 小时） | `firstSeen`、`expiresAt`；`THREAT_TTL = 72 h`，合约上限 `MAX_TTL = 7 天` | 一致 |
| 续期要新证据 | 同一 evidenceHash 第二次写入不计数、不续期；新证据 count + 1、expiresAt 取较晚 | 一致 |
| workflowId | 条目不存；Receiver 写入前检查 forwarder 与 workflow 白名单 | 证据包从 Receiver 交易的报告元数据取（方式 B 时为空，要说明是模拟） |
| 每个地址的历史 | 只存最新一个 evidenceHash；历史在 `ThreatAdded` 事件里 | 证据包按事件列出 |

### 4. 行为指纹

| 项 | 规格 | 仓库 | 判断 |
| --- | --- | --- | --- |
| 组合数 | 3 到 4 组特征，各算一个哈希 | **一组**：`keccak256(abi.encode(chainId, token, amountBucket, actionType))` | 简化版。匹配要求金额桶完全相同，召回会低 |
| 金额分桶 | 按代币单位取对数 | `floor(log2(amount / 0.01 token))`，夹在 0 到 40 | 一致 |
| 是否新地址、星期几的时段、是否贴着假门槛 | 有 | 没有新地址和时段；`actionType` 有 PROBE 和 THRESHOLD_HUG 两种 | 部分 |
| 不含地址 | 是 | 是 | 一致 |
| 交易所 B 的用法 | 地址命中转人工；指纹命中加似然比；最多跟到 L1 | 地址命中转人工（D13）；指纹命中 λ = 2303，「单独命中不改变决定」 | 一致 |

### 5. ThreatRegistry 接口

| 规格 | 仓库 | 判断 |
| --- | --- | --- |
| 只接受 QuorumReceiver 写入 | 只接受已登记的 Receiver，且 `reporterOrg` 必须匹配 | 一致 |
| 写入时链上验 Merkle 证明 | 非衍生条目必须验过（`decoyCommit.verifyMem`） | 一致 |
| 按地址查 | `isSuspect`、`entryOf` | 一致 |
| 按指纹查 | `fingerprintActive` | 一致 |
| 按编号读完整条目 | **没有条目编号**；按地址读 | 证据包用「地址 + evidenceHash」当编号 |
| 事件：新增、续期 | 只有 `ThreatAdded`（`count > 1` 即续期） | 等价 |
| 拒绝写入自家合约地址与 0 地址 | 有（`isProtected`、`ZeroSuspect`） | 仓库多一层保护 |
| 读取成本 | 未提 | v1：`activeConfirmedCount` 按到期小时分桶，最多读 169 格（audit High 2） | 仓库多考虑了 |

## 要对外说清楚的一句话

DecoyCommit 能证明「这个诱饵是事先承诺过的」；**不能**证明「那笔触发交易真的发生过」。后者靠 CRE 节点核实，或者任何人用 RPC 自己查交易回执（见 evidence_package.md 第 3 步）。
