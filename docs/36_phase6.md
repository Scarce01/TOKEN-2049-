# 阶段 6：Patrol 完整版与评估（第 22 到 25 小时）

## 目标

- Patrol 补齐：对账、额度按期补充、温补热、CUSUM（P2）、触发后一跳溯源（P2）、XRP 诱饵（P2）、诱饵凭证（P2）
- 用公开链上数据和真实事件，把 pitch 里的数字做出来：最坏损失、检测延迟、误报率、Bybit 重放

P2 项目在第 24 小时还没开始就砍掉，写进 STATUS。

## 前提

阶段 3 完成。阶段 4、5 若没完成，在 STATUS 标「跳过」，`verify:design --phase 6` 会把它们的 D 项显示为 not-yet，而不是失败。

## 任务

### 6.1 对账（P1）

QuorumVault 没有裁决就执行不了，所以「每笔流出都对上 APPROVE」在金库上是合约保证的，对账要查的是合约保证之外的地方：

| 检查 | 方法 | 不符时 |
| --- | --- | --- |
| **资产守恒**：每个 org、每种代币，V = 热金库余额 + 温金库余额 + 两个金库的 extOutTotal − 两个金库的 fundedTotal。合法的流出（execute、sweepToCold）余额减少、extOutTotal 同额增加；温补热是内部转账，两边相抵；经 fund() 的注资余额增加、fundedTotal 同额增加。所以正常情况下 **V 不变**；V 变大只可能是有人直接转钱进金库（不经 fund），V 变小就表示有我们没记到的出金路径 | 和 PatrolState 的 ASSET_CHECKPOINT（SAFE 区块上的 V，高水位）比。**不读日志**，读取量和流量无关 | 锚点区块看到 V 变小：先做软收紧（热金库 QUOTA_ZERO + L2），不冻结；SAFE 区块也看到变小：确认级，证据写 (org, 代币, 检查点区块, SAFE 区块, 短少金额) |
| 真运维 EOA（ops-gas-01 与另一个，地址在 secrets/ops-eoas.local.json）的**代币**转出只去 Patrol config 里的允许地址；原生币只允许每个窗口不超过 gas 预算的下降 | filterLogs + patrolView | L2 警戒（它们是真钱包，不是诱饵）。允许地址放 Patrol config，不信交易所数据库 |
| 配置漂移：各金库 `configHash()` 等于 Patrol config 里的固定值 | patrolView | FREEZE（D37） |

所有对账都是「收紧」。资产守恒分两段：锚点区块（latest − ANCHOR_LAG）看到就先软收紧，等 SAFE 区块也看到才上确认级。原因：确认级会冻结温金库，误报的代价很大；unsafe 区块被重组掉一笔注资，就可能让锚点区块的 V 暂时变小。SAFE 在 Base 上约落后 2 到 5 分钟，这段时间热金库额度已经清零，攻击者拿不走更多。

**检查点（ASSET_CHECKPOINT，P1，不依赖 CUSUM）：** quota handler 每次执行读 SAFE 区块的 V，和 QUOTA_REFILL 写在同一份报告里（没有要补的额度时单独写；每次执行都写）。合约只接受不比现值小的 assetValue（高水位），所以检查点只会跟着「直接转入」往上走，不会被拉低。例外：
- 金库登记变了（vaultSetHash 不同）：V 的定义变了，直接写新值
- reset-demo 重新部署 PatrolState：第一次执行只写检查点、不比对
- 查明原因后，人员两人签名 RESET_ASSET_CHECKPOINT（排队 MANUAL_DELAY，不是 CONFIG_DELAY），对账从新值重新开始。V 一直比检查点小时，确认级动作每分钟会重发（幂等）

**为什么不用日志逐笔对：** 早先的设计用 filterLogs 逐笔比对金库的 Transfer 与金库事件，读取量随流量增长；回复大小上限没有文档；后台还能故意囤积 APPROVE 再一次执行，让窗口读不完。资产守恒只读两个数，攻击者无法让它「读不完」。

**它抓不到什么（写进 proposal 边界）：** 有人从我们不知道的路径拿走 X，同时又不经 fund() 直接转 X 进金库，V 不变。正常的注资（交易所注资、冷钱包放款）都走 fund()，所以只有「直接转入」能掩盖；检查点每次执行都更新，但它落在 SAFE 区块（Base 主网约落后 2 到 5 分钟，Sepolia 待实测），所以掩盖窗口约是 SAFE 的落后时间加一个执行间隔。能直接转钱进来的，是掌握交易所其他钱包的人；被攻陷的后台确实可以拿收款地址里的钱来掩盖，但那些钱它本来就能直接拿走，金库的保护没有因此变弱。

不再逐笔查「每个 Executed 都对上 APPROVE」：execute 一定要先 consumeVerdict 才能转账，这由合约保证，并由不变量 I1 检查（40_verification.md 4.1）。D26 相应改写。

**「对账干净」给 quota handler 用：** quota handler 自己读锚点、SAFE、FINALIZED 三份 V：锚点与 SAFE 的 V 不小于检查点，而且检查点的 safeBlock 不晚于 finalized 区块时，FINALIZED 的 V 也不小于它，才算干净；不依赖 reconcile handler 有没有跑。V 变小时 quota handler 只是不补额度，收紧动作由 reconcile handler 发。请求积压（10_interfaces.md 3.1 的分钟桶）超过 BACKLOG_MAX 也算不干净。

### 6.2 额度按期补充与温补热（P1）

- 由 patrol 的 `quota` handler 负责；epoch = floor(区块时间 / QUOTA_PERIOD)
- 合约规则见 10_interfaces.md 第 4 节：epoch 只要大于上次即可（漏掉几分钟不会卡死），补充量 ≤ r_max × 间隔期数，不超过 cap
- 补之前，LATEST 和 FINALIZED 两份数据都要满足：对账干净、alert < 4、没冻结；CUSUM 报警时补充量减半
- 链上兜底：alert = 4 或冻结时，refillQuota、topUp 直接 revert。Base Sepolia 的 finalized 可能落后约 20 分钟，只看 FINALIZED 会在收紧之后又把额度补回来
- TOPUP：报告里给目标余额（热金库 qUSD 8,000、qETH 2），合约补到目标，重复执行没有效果
- 测试：
  - 跳过几个 epoch 后仍能补，补充量按间隔计算
  - 同一 epoch 第二次被拒
  - 确认级期间 refillQuota、topUp 都 revert
  - workflow 单元测试：mock 成 LATEST 干净、FINALIZED 不干净时不补，反过来也不补（D10）

### 6.3 CUSUM（P2）

- 每分钟、每个热金库、每种代币：x_t = 这一分钟 execute 转出的总额（代币数量，不换美元），**直接取自金库的 outRing**（10_interfaces.md 3.3），不用 filterLogs，所以读取量和流量大小无关
- 由 quota handler 计算（它要用 CUSUM 的结果决定补充量），不另开 handler
- 基线按「一周中的第几个小时」分 168 组（交易所提款有明显的日夜周期）。**基线是固定的，不在线学习：** 168 组 (μ, σ) 用 BigQuery 的 H0 离线算好，放 Patrol config；要更新就离线重算、重新部署 workflow（方式 A 走 workflow 更新，Receiver 只认 owner 与 name，不受影响）
  - 好处一：检查点只需要存 S，重算和逐分钟计算一定相同（D58）
  - 好处二：「温水煮青蛙」（策略 5）没办法慢慢把基线抬高，原本的「报警期间冻结 μ」「μ 每天上升上限」都不需要了
  - 代价：交易所业务量真的长大时，误报会变多，要定期重算。这是对 proposal §6 F「EWMA 基线」的偏离，记进 STATUS
- PLANNED_OP（人员事先两人签名报备的计划内调拨）：在 max(windowStart, registeredMinute) 到 windowEnd 的每一分钟，x_t 扣掉报备的每分钟上限，扣到 0 为止。用 Lens 查与重算区间重叠的全部条目（含已过期的），登记之前的分钟不受影响
- 报警只减半补充量；CUSUM 要和另一个独立信号（例如同一窗口有 PENDING 51 或指纹命中）同时出现，才把 org 警戒升到 L1（D55）
- 取对数：整数 log2 近似，放大 1000 倍
- z = (log x_t − μ_h) / max(σ_h, σ 下限)，h 是这一分钟属于一周中的第几个小时；S = max(0, S + z − k)；S > h_alarm 报警
- **检查点 + 重算，不每分钟写链：**
  - PatrolState 存检查点 (minute, S, alarm, gap)
  - 每次执行：从检查点的下一分钟开始，用 outRing 逐分钟重算到锚点区块的上一个完整分钟（锚点 = latest − ANCHOR_LAG，10_interfaces.md 第 9 节）；同一份输入每次算出的结果相同（纯函数，WU 测试）
  - 每 10 分钟写一次 PATROL_STATE；alarm 状态改变时立即写
  - outRing 有 32 格，检查点最多落后 10 分钟，所以 Patrol 停摆约 20 分钟内都能补算
  - 停摆更久：没被 outRing 覆盖到的分钟不计入，写检查点时 gap = true，Console 显示「CUSUM gap」。这段时间的损失上界仍由额度桶保证
  - PATROL_STATE 和 QUOTA_REFILL 放同一份报告，不另发交易。省下的是存储写入：每个 org 每种代币每天约 150 次，不是 1,440 次；报告数量由额度补充决定（有流量时每分钟一份）。这是对 proposal §6 F「每分钟写一次」的偏离，记进 STATUS（D58）
- 报警只把 QUOTA_REFILL 减半，不封锁
- **尖峰规则（Shewhart，补 CUSUM 的盲点）：** CUSUM 抓「慢慢抬高」，抓不到「几笔巨额」（Bitget 回测，STATUS）。某一分钟 x_t > spikeMax（每种代币一个，代币数量；建议取 H0 每个活跃分钟 p99 的 10 倍）时，S 直接设为 h_alarm + spikeHold（默认 20 × 1000），报警立刻成立，之后照常随 z − k 衰减（空闲分钟约十分钟内回落）。只改 S，所以检查点格式和 D58 都不变；动作和 CUSUM 报警一样只减半补充量，升 L1 仍要第二个独立信号（D55）。config 没有 spikeMax 或为 "0" 时不启用。Bitget 回测（analysis/bitget_spike.py，公开链上数据；误报只按事发前 3.8 天算）：10 倍 p99 时 USDT 在 18:58（第一笔大额那一分钟）、ETH 在 19:01 报警，早于 Bitget 19:05 发现；误报每天 0.53（USDT）、0.27（ETH）
- 参数先用默认值，6.6 用公开数据重调

### 6.4 一跳溯源（P2）

- 链上部分：Trap 触发后 30 分钟内，Patrol 每次执行用 filterLogs 查 suspect 的 Transfer 转出，按比例分配污点：下一跳 j 的污点 = 收到的金额 / j 在窗口内的总流入
- 排除清单（config）：已知交易所、DEX 路由、跨链桥、我方合约
- 污点 ≥ 50% 的下一跳写 THREAT（parentEvidence = 原始条目的 evidenceHash，有效期 24 小时，不需要 Merkle 证明，但父条目必须仍有效）
- 由 patrol 的 `trace` handler 负责，只在有活跃案件时工作
- **为什么只做一跳：** 每次执行最多 15 次 EVM read，执行之间没有状态，RPC 也没有「列出某地址全部转出」的接口（原生币转账连 log 都没有）。多跳搜索放在 CRE 里跑不动，也很难让各节点拿到一样的结果
- **深层溯源（P2，路线图优先）：链下搜索、CRE 核实。** 链下（BigQuery 或索引器）跑多跳污点传播，算出可疑的资金路径；把每一条边（父地址、子地址、交易 hash、logIndex）经 HTTP trigger 交给 patrol 的 `verify-edge` handler（每 30 秒最多一次，每次最多 12 条边，每条一次 getTransactionReceipt）：它用 getTransactionReceipt 读这笔交易，确认那个 Transfer 真的存在、from 与 to 对得上、金额正确，而且父地址的条目仍有效，才写衍生 THREAT（parentEvidence 指向父条目）。搜索很贵，放链下；核实很便宜，交给 CRE 共识。链下服务只能提出边，不能直接写名单
- 台上的说法：「CRE 负责第一时间、可共识地把攻击者地址写进名单；更深的溯源在链下算，每一条资金路径都由 CRE 节点各自核实后才上链。」
- 离线部分（41_evaluation.md 第 2 节）：
  - `analysis/trace_bybit.py`：以 Bybit 攻击者公开地址为种子，攻击后 5 天，1 跳与 2 跳按比例污点传播；对比 FBI 清单，算召回率 @k、精确率下界、跨链断点、时间优势
  - 同一计算用 3 个数据来源（NOWNodes、另一个 RPC、BigQuery）各跑一次，输出逐字节一致（D51）
  - 排除清单来自 datasets.benign_labels；衍生可疑地址再对 Forta / EtherScamDB 与知名标签检查误伤
  - Bitget 攻击者一跳作为补充展示
  - 所有地址、区块、清单先从公开原文核对，记进 STATUS

### 6.5 XRP 诱饵与诱饵凭证（P2）

- **XRP：** S7 显示 NOWNodes 支持 XRP 测试网才做。Patrol 用 HTTP 调 `account_info` 读余额，规则同 2.5（低于 floor 即确认级）；不支持就砍
- **诱饵凭证：**
  - services/canary：一个假的「托管签名服务」，收到任何使用就签名回调 Trap 的 HTTP trigger（10_interfaces.md 8.6）
  - exchange_a.api_keys 加一条它的 key
  - 红队 `use-api-keys` 会试用后台里所有 key

### 6.6 用公开数据定参数

| 项目 | 做法 | 输出 |
| --- | --- | --- |
| 热钱包流出数据（H0） | 选 3 家交易所公开标注的以太坊热钱包（记录标注来源）；用 BigQuery 的 token_transfers 拉 30 天，按分钟加总写 hot_wallet_outflows，单笔写 h0_withdrawals | 数据表 + 来源 |
| 门槛用经验分位数 | 额度桶、CUSUM 的 h、关 7 的上限都从 H0 的分位数取（例如 99.99 分位），不拍脑袋 | config + metrics |
| 正常用户模拟器 | 从 h0_withdrawals 抽样生成正常流量，混入攻击策略；报告 41_evaluation.md 第 6 节的误报指标 | metrics（D54） |
| 运维流量重放（金丝雀的金丝雀） | 把一段正常运维流量（定时补仓、批量出金、冷转热）在测试网完整重放；诱饵触发必须为 0 | `scenes/ops_replay.sh`（D49） |
| 额度桶参数 | C = 每分钟流出 p99 × 倍数，r_max = 每分钟 p99；算「有多少比例的分钟要转核验车道」 | metrics（public_onchain） |
| CUSUM 误报率 | 用 Bitget 事件前 30 天的热钱包流出跑 6.3 的算法，数报警次数，调 h 让每月误报 < 1 | metrics |
| Bitget 当天 | 拉 Bitget 热钱包在事发当天的流出，跑 CUSUM，看第几分钟报警；对照公开时间线（测试转账、大额流出、对账发现） | 图 + metrics |
| 最坏损失 | 用 Bitget 时间线：L(T) ≤ C + r_max · ⌈T⌉，与实际流出对比 | 图（标「公式上界」） |

Bitget 热钱包地址、事发区块、时间线，全部先对照公开报告原文，写进 STATUS 并附链接；找不到可信标注就不做这一行，不要猜地址。

### 6.7 Bybit 重放

- 参考 DeFiHackLabs 的分叉重放方法：用 Anvil 分叉 Bybit 被盗前一个区块的主网，重现那笔恶意 Safe 交易，记录它实际做了什么（改 masterCopy），作为证据截图
- 同一笔交易的 calldata 再按 kind 1 提交到我们的 RequestBoard，预期 REJECT 21

- 从公开报告取 Bybit 事件中恶意 Safe 交易的 hash，并核对原文
- 用 NOWNodes 取主网交易与 calldata，解码出 Safe 的 execTransaction 参数（operation = 1）
- 以 kind 1 提交到 RequestBoard，预期 REJECT 21
- 显示在 Console 的 Cases 页，三栏对照里标出 operation = DELEGATECALL

### 6.8 评估表

| 指标 | 来源 | 对应 |
| --- | --- | --- |
| 命中概率曲线 | 公式 | A |
| 诱饵 AUC | 合成数据 | B |
| trap_to_freeze_seconds | 测试网实测 | C、J |
| 触发后攻击者还能拿走的金额 | 红队实测 | G |
| 最坏损失上界 vs Bitget 实际 | 公式 + 公开数据 | G |
| CUSUM 误报率、Bitget 当天报警时间 | 公开链上数据 | F |
| network_recognition_seconds | 测试网实测 | H |
| request_to_verdict_seconds | 测试网实测 | 预防层 |

全部写 metrics，Console 有一页 Evaluation 列出，每行显示来源类型。

## 设计一致性（必须通过）

D10、D14.2（主网 Bybit 交易）、D18、D24、D25、D26、D27、D31、D32、D37、D38（若砍掉则 waived）、D45、D48、D49、D51、D54、D55、D58、D61、D62、D65，以及 D03（XRP 部分，若有做）、D07（若有做）

## 完成标准

- [ ] 对账、按期补额度、温补热生效；放宽只用 finalized 数据
- [ ] 评估表每行都有值和来源
- [ ] Bybit 重放 REJECT 21
- [ ] 砍掉的 P2 写进 STATUS
- [ ] `pnpm verify:design --phase 6` 全过
