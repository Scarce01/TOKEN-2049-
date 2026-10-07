# Trek 服务：怎么接、怎么用、测到了什么

状态：2026-10-06。代码在 `analysis/trace_bybit/trek.py`，测试 `tests/test_trek.py`（56 个测试全过，含溯源部分）。**只有 Bybit 一个案例；回放用缓存数据，实时数据源只在最近的区块上测过。**

## 1. 它是什么，不是什么

流程（见上一页的图）：诱饵被碰 → CRE 共识 → 广播到共享名单 → **Trek** 往下跟 → 提议给 CRE 核实 → 安全网（延迟）。同时 **trace back** 往回找源头。

Trek 是**链下、不可信**的服务（和 exchange-api 一样）：
- **它从不写链，只提议。** 每条提议带着 `ThreatRegistry.add` 的参数，加上那一笔能证明污点的转账，由 CRE 的 verify-edge 去链上核实后才写入。
- **它只提议延迟，不提议冻结。** 种子地址的确认级冻结是 Trap workflow 的事（docs/47：可疑只多等）。

## 2. 提议的格式（给 CRE 负责人）

每行一个 JSON（`trek.py watch` 输出的 JSONL）。关键字段：

| 字段 | 含义 |
| --- | --- |
| `kind` | `edge`（一个被污染的钱包）或 `exit`（钱到了交易所、服务等出口） |
| `action` | `delay`、`watch`、`notify`、`hold_deposit`，**没有 freeze** |
| `hop`、`taintPpm`、`taintedIn` | 第几跳、污点比例（百万分之）、累计被污染金额 |
| `edge.parent`、`edge.child`、`edge.txHash`、`edge.logIndex`、`edge.asset`、`edge.amount` | **让 verify-edge 去读的那一笔转账**（与 docs/36 6.4 的字段一致） |
| `edge.native` | 是不是原生 ETH（没有日志） |
| `threat.suspect`、`chainId`、`evidenceHash`、`fingerprintHash`（0）、`expiresAt`（建议值）、`parentEvidence`、`proof`（`0x`） | **对应 `ThreatRegistry.add` 的前七个参数**；第八个 `reporterOrg` 不由 Trek 提，见下 |

`evidenceHash = keccak256(abi.encode(chainId, txHash, logIndex))`，与 `packages/shared/src/ids.ts` 一致（用 `cast` 核对过）。`parentEvidence`：第 1 跳指向触发的诱饵证据（`--trigger-evidence`，目前默认全零，**接 Trap 的输出时要传入**），更深的指向父钱包的 `evidenceHash`。

### 档位

| 条件 | action |
| --- | --- |
| 污点 ≥ 90%，累计被污染金额 ≥ 下限，≤ 3 跳 | `delay` |
| 其余已达门槛的 | `watch`（记录，不动作） |
| 钱到了成员交易所的地址 | `hold_deposit` |
| 钱到了别的出口 | `notify` |

重复发送同一钱包时：同一档位只发一次；`watch` 升级成 `delay` 时再发一次（同一个 `evidenceHash`，消费方要按幂等处理）。

## 3. 怎么跑

```bash
cd analysis/trace_bybit
python3 trek.py replay --caps 10,50,0          # 用缓存的 Bybit 数据逐区块回放，写 results/trek_replay.json
python3 trek.py watch --seed 0x... --from-block N --blocks 20 --out proposals.jsonl   # 实时（公共 RPC，只支持较新的区块）
python3 -m pytest -q                           # 56 个测试
```

## 4. 回放结果（Bybit 缓存，逐区块，CRE 执行时间按 0 算）

预算 `track_cap` = 同时盯住几个钱包（种子永远盯，不占预算）。

| 预算 | 提议总数 | 其中延迟 | 名单上 51 个被提议 | 所有延迟钱包里「标记后才转出」的 | 它们转出前多久被标记（p10 / 中位 / p90） |
| --- | --- | --- | --- | --- | --- |
| 10 | 57 | 52 | **51 / 51** | 21 | 79 分钟 / 2.8 天 / 4.7 天 |
| 50（默认） | 1,015 | 1,010 | **51 / 51** | 506 | 96 秒 / 5.2 分钟 / 41 分钟 |
| 不限 | 4,166 | 3,103 | **51 / 51** | 933 | 84 秒 / 3.6 分钟 / 31 分钟 |

**注意：预算 10 也找全 51 个，是 Bybit 这个案例的特点，不能推广。** 名单里 40 个是种子的直接子女（不占预算），另外 11 个来自两个枢纽钱包（被污染的 ETH 约 19.7 万和 9.8 万，是金额最大的，自然在盯住的前 10 里）。资金分布更平的案例需要更大的预算。

### 如果标记有延迟，还有多少钱包没转走（预算 50）

| 标记要花多久 | 仍未转出的占比 |
| --- | --- |
| 12 秒（一个区块） | 100% |
| 1 分钟 | 94.7% |
| 10 分钟 | 32.4% |
| 1 小时 | 7.9% |

### CRE verify-edge 的吞吐够不够（计划：每 30 秒最多 12 条边）

| 预算 | 延迟提议 | 其中后来转出的 | 在转出前完成核实 | 等待（中位 / p90 / 最长） | 队列峰值 |
| --- | --- | --- | --- | --- | --- |
| 10 | 52 | 21 | 21（100%） | 12 / 24 / 24 秒 | 0 |
| 50 | 1,010 | 506 | 506（100%） | 12 / 24 / 24 秒 | 0 |
| 不限 | 3,103 | 933 | 931（99.8%） | 12 / 24 / 24 秒 | 0 |

回放里（预算 50）5 天内**任何一个 30 秒窗口最多只有 9 条**延迟提议，没有超过 12 条，所以队列没有积压；预算不限时队列峰值也是 0。Trek 提交时「被污染金额最大的先发」。**这里 CRE 单次执行时间和写链确认时间按 0 算**，实际要加上去，上面那张「标记要花多久」的表就是敏感度。

## 5. 限制（照实写）

1. **只有 Bybit。** 其他团伙的节奏、拆分方式可能不同；Stake、Bitget 没有回放。
2. **回放有「事后诸葛」的地方**：交易所和服务的识别用了整个 5 天窗口里的对手方数量，实时时没有这些信息。
3. **免费公共 RPC 没有历史日志**（publicnode 要个人令牌，dRPC 报未知状态），所以 2025 年的 Bybit 区块无法在真实链上重放。实时数据源只在最近的区块上测过：5 个区块抓到 7 条边（6 条 USDT 带日志序号、1 条 ETH），约每区块 1.6 秒。
4. **看不到合约内部的 ETH 转账**（实时路径只读区块和 Transfer 日志）；回填历史时用 Etherscan，那里有。
5. **标记之前的历史靠回填**：一个钱包第一次被盯住时，会用 Etherscan 补它之前的转入，否则「被污染占比」会虚高（单元测试覆盖）。回填只补转入，不补转出，避免时间顺序错乱。
6. **非 ETH 代币需要价格配置**：实时数据源按案例配置换算金额；Bybit 配置里没有价格，所以不要用它跟稳定币。
7. **代币转账用 Etherscan 数据时没有日志序号**，`evidenceHash` 为空，要用 RPC 数据才有。

## 6. 要和 CRE 负责人对齐的事

1. **原生 ETH 转账怎么核实**：它没有日志，所以 `evidenceHash` 里的 `logIndex` 我暂定用 `0xFFFFFFFF`（`NATIVE_LOG_INDEX`），这只是我的提议。CRE 的 EVM 客户端能不能按交易哈希读交易本身（from、to、value），还是只能读回执？**如果只能读回执，原生 ETH 就无法核实**，要换办法。
2. **`parentEvidence` 第 1 跳指向什么**：我设成 Trap 对诱饵转账产生的 `evidenceHash`，需要 Trap 的输出接进来。
3. **verify-edge 的触发方式**：docs/36 写的是 HTTP 触发、每 30 秒、每次最多 12 条。Trek 会按金额从大到小提交，格式如上。
4. **`delay` 在安全网里具体怎么实现**：Ziyu 的 PR #14、#15（按提款延迟）还没合并，Trek 的 `delay` 档要和它的档位（D1 到 D3、D_LARGE）对上。
5. **谁来跑 Trek**：目前是一个 Python 脚本，放在 `analysis/` 下。要变成长期运行的服务，需要决定放哪、用谁的密钥提交（它没有链上密钥，只发 HTTP）。


## 合约一侧的约束（对照 `ThreatRegistry.add`，2026-10-07 核对）

- **`reporterOrg`：** `add` 只接受已登记 Receiver 的调用，且参数里的 org 必须等于该 Receiver 登记的 org。所以它由 CRE 写入时填，Trek 不提。
- **`expiresAt`：** 合约要求大于当前区块时间且不超过 7 天。Trek 给的是「边的时间加 72 小时」，只是建议值；边的时间如果已经很旧会被拒（`BadExpiry`）。按 CLAUDE.md 第 5 条，CRE 应该用触发区块头时间加 THREAT_TTL 重算，不直接采用 Trek 的值。
- **`parentEvidence`：** 非零即为衍生条目，合约要求父条目仍有效，否则 `ParentInvalid`。所以 verify-edge 必须先写父条目再写子条目：`verify_queue` 现在按「跳数从小到大，再按金额从大到小」排序，并返回实际验证顺序（`order`）。父条目超过 72 小时过期后，它的新子条目也写不进去。
- **幂等：** 同一个 `evidenceHash` 再次提交，合约直接返回，不累加。Trek 重发升级提议（watch 升级为 delay）时证据相同，不会重复计数。
- **根：** 第一跳的 `parentEvidence` 是 Trap 命中的 evidenceHash，且那条必须是 `proof` 通过的非衍生条目。需要 Trap 一侧把它放进广播（问题见 issue #17）。
