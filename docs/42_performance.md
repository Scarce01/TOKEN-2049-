# 42 性能：延迟、吞吐量、链上写入、缓存、数据库

## 1. 已核对的前提（2026-10-05，附来源）

| 事实 | 数值 | 来源 | 影响 |
| --- | --- | --- | --- |
| log trigger 限流 | **每个 workflow** 每 6 秒 10 个事件（burst 10），不是每个 trigger；同一 workflow 里的多个 log trigger 共用这份额度（文档没写分开计，按共用设计） | CRE service quotas（`PerWorkflow.LogTrigger.EventRateLimit`） | 不能靠多开 trigger 分片提高吞吐；同一个事件不能被两个 handler 各算一次 |
| HTTP trigger 限流 | 每个 workflow 每 30 秒 1 次 | 同上 | 只适合诱饵凭证回调这种罕见事件 |
| 每个 workflow 最多 trigger 数 | 10 | `PerWorkflow.TriggerSubscriptionLimit` | |
| 单个 log 事件大小 | 5 KB | `LogTrigger.EventSizeLimit` | 批量请求不能把完整内容放进事件 |
| 报告大小 / 每笔交易 gas | 50 KB / 10,000,000 | `ChainWrite.ReportSizeLimit` | |
| getTransactionByHash | 回复含 calldata（`data`），**不含 from** | CRE EVM client 参考 | 批量请求可以从 calldata 取回；需要发送者时改用别的方式 |
| EVM read 回复大小（含 filterLogs） | **文档没写**；请求 payload 上限 5 KB；共识观测上限 25 KB | service quotas | 一次 filterLogs 能读回几笔要实测（spike S9）；设计上不让读取量随流量线性增长（第 4 节） |
| 读旧区块的状态 | 一般全节点保留最近约 128 个区块的状态（geth 预设）；Base 的节点实现与 NOWNodes 的设定没查到 | 节点实现的预设，未对 Base Sepolia 实测 | 只影响诱饵的窗口下降检查（读锚点 − N）；S9 实测，不行就只留 floor 检查。对账不读旧区块 |
| Base Sepolia 的 safe / finalized 落后 | 约 2 到 5 分钟 / 约 15 到 30 分钟（主网数据，Sepolia 要实测） | Base 与 OP Stack 的 finality 文档 | Cosign 不能等 SAFE；放宽用 FINALIZED 会慢 20 分钟左右，可以接受，但必须有链上兜底 |
| Ponder | 0.17.x（2026-09 仍在维护）；基于 viem；可写外部 Postgres（需要独立 schema）；自动处理重组 | ponder.sh 文档、npm | 索引器改用 Ponder |
| pg-boss | 支持 Bun；advisory lock 是事务级 | pg-boss README 与源码 | 用 Supabase 的直连或 session 模式（5432），不要用 transaction 模式连接池 |
| eRPC | 开源，有重组感知的缓存、故障切换、限流 | github.com/erpc/erpc | 阶段 8 或之后加 |
| Multicall3 | Base Sepolia 已部署于 `0xcA11bde05977b3631167028862bE2a173976CA11` | mds1/multicall3 deployments.json | 链下服务批量读取 |
| OpenZeppelin v5 | BitMaps、MerkleProof（含多重证明）可用 | @openzeppelin/contracts 5.6.1 | 路线图的批量裁决会用到 |
| pg_partman | Supabase 文档列出，但有 issue 说旧镜像没有 | Supabase 文档与 issue #1586 | 先用 SQL 查；没有就用原生分区 + pg_cron 建分区 |
| 模拟器的配额 | `cre workflow simulate` 预设套用生产配额；`--limits none` 全关；也可给自订 JSON；`cre workflow limits export` 可导出 | CRE 文档 Testing Production Limits（2026-10-05 查） | 测量一律用预设配额；仓库禁止 `--limits none` |
| 超过 log trigger 限流的事件 | **文档没写**是丢掉还是排队 | 无 | spike S10 实测；设计上两种情况都靠 resubmit 兜底 |
| 不同节点的 latest | 文档没写 cron handler 里各节点是否先对齐区块号 | 无 | cron handler 用 latest − 5 当锚点，降低不一致的机率；本地 simulate 是单节点，证明不了 |

## 2. 延迟预算（每一步都要分开量）

| 步骤 | 估计（方式 A） | 估计（方式 B） | 量法 |
| --- | --- | --- | --- |
| 交易进区块（诱饵转出、提交请求） | 2 秒左右 | 同左 | 区块时间 |
| CRE 收到 log trigger（LATEST） | 数秒 | sim-runner 收到事件：数秒 | trigger 日志时间戳 − 区块时间 |
| workflow 执行 | 数秒 | simulate 每次可能 10 到 40 秒（含编译与启动） | 执行开始与结束日志 |
| 报告进区块 | 2 秒左右 | 同左 | 报告交易的区块时间 |
| 后台执行转账（只适用提款） | 收到裁决后 1 个区块 | 同左 | Executed 区块时间 |
| **合计：诱饵触发到冻结** | 约 5 到 20 秒 | 约 20 到 60 秒 | trap_to_freeze_seconds |
| **合计：请求到裁决** | 约 5 到 20 秒 | 约 20 到 60 秒 | request_to_verdict_seconds |

以上都是估计，阶段 2、3 每一段分开实测，写进 metrics：`lat_include`、`lat_trigger`、`lat_exec`、`lat_report`、`lat_execute`。

**Cosign 改用 LATEST，只留一个 handler。** SAFE 在 Base 上要等批次交到 L1，每笔提款平白多等几分钟。改用 LATEST 之后，重组会带来三种情况，都由合约挡住，不靠区块确认：

- **充值被重组掉：** 合约写入 APPROVE 时会在当时的正式链上再查一次 approved + amount ≤ depositedOf，不够就改成 PENDING 51
- **请求被重组掉，但裁决交易又被打包进新链：** 合约写 VERDICT 前先查 RequestBoard.txHashOf(requestId) 等于报告里的 txHash，对不上就忽略（VerdictOrphaned）。后台拿同一份签名换一个 requestId 重提时，金库按 (userIdHash, nonce) 只付一次款
- **节点读到的「事件所在区块」不一致：** 节点无法共识，这个请求没有裁决；超过 RESUBMIT_AFTER 后由 resubmit 重发（10_interfaces.md 3.1）

关 3 的钥匙核对也在合约里再做一次：写 APPROVE 时 signerOf(requestId) 必须等于当时的 keyOf(userIdHash)。原本的 decoy-fast 和 main 两个 handler 合成一个：每个事件只算一次 log trigger 额度。

## 3. 吞吐量

**CRE 的上限：** 每个 workflow 每 6 秒 10 个事件，约每秒 1.67 个，两家交易所共用同一个 Cosign。这是配额上限，不是实测值。

**链上分配（比赛版）：** RequestBoard 替每个 org 设 token bucket：A 容量 5、每 1.2 秒补 1；B 容量 4、每 1.5 秒补 1。合计每秒 1.5 个、容量 9，留一点余量。超过就 revert，交易所退避重试。效果：

- 被攻陷的后台最多占满自己那一份，挤不掉另一家，也挤不掉 Trap（Trap 是另一个 workflow）
- 每个请求最终都有裁决：事件被丢或报告被拒，靠 resubmit 重发；Patrol 按提交分钟比对请求数与裁决数，积压就不补额度并升 L1
- 单家交易所的比赛版吞吐：A 约每秒 0.83 笔（每天约 7 万笔）。方式 B 下更低，由 sim-runner 决定（实测）

**路线图 1：批量请求 + Merkle 裁决**

- 后台每个区块调用 `submitBatch(requests[])`：完整请求放在 calldata；事件只发 (batchId, requestsRoot, count)
- Cosign 用 getTransactionByHash 取回 calldata，用 requestsRoot 核对完整性，逐笔判定
- 报告写 (batchId, approvedRoot, PENDING 与 REJECT 的清单)；金库执行时带该笔在 approvedRoot 里的证明；已用的记在 BitMaps 里
- 批量大小受 EVM read 回复大小限制（文档没写），先用 spike S9 实测；初估每批 40 笔
- 效果：每秒约 1.5 批，约 60 笔；链上每批只存一个根

**路线图 2：小额授权分级**

- 用户签一份授权：「每天最多 X，只能付到我的白名单地址」
- 小额提款由金库核对授权与额度桶直接放行，不进 Cosign；大额、新地址走逐笔裁决
- 安全性：
  - 仍然要用户签名，后台伪造不了
  - 小额部分的损失有额度桶封顶
  - 诱饵不受影响
- 代价：小额不再逐笔检查，要写进 proposal 的边界

**不采用：多 trigger 分片。** 限流按 workflow 计，分片没有用；我们用一个 CRE 账号的 3 个 workflow 服务两家交易所，多开 workflow 也会让 Receiver 白名单与诱饵配置分散，不值得。

## 4. 链上写入与读取量

设计原则：**Patrol 每次执行的读取量不随流量增长。** 需要「这段时间流出多少」的地方，由金库在写入时顺便记账，Patrol 只读几个数。

| 项目 | 比赛版 | 路线图 |
| --- | --- | --- |
| 裁决 | 每笔一份（约 4 个存储槽），按 txHash 只写一次 | 每批一个根 + BitMaps nullifier；按期号分桶，过期不再读 |
| 提交额度与积压 | RequestBoard 的额度桶、请求分钟桶；Receiver 的裁决分钟桶（各 32 格） | 同左 |
| CUSUM 输入 | 热金库的 32 格分钟桶 outRing（execute 时累加，约多 1 次 SSTORE）；一次 patrolView 读完 | 同左 |
| CUSUM 状态 | 基线是 config 里固定的 168 组，链上只存检查点 (minute, S, alarm, gap)。每 10 分钟写一次，alarm 改变时立即写，和 QUOTA_REFILL 同一份报告。省的是存储写入（每天约 150 次，不是 1,440 次），不是报告数量 | 只在报警与每小时写 |
| 对账 | **资产守恒**：V = 热 + 温余额 + 对外累计转出 − 经 fund() 的注资，正常情况下不变。和 ASSET_CHECKPOINT（SAFE 区块，高水位，每次执行更新，有补额度时同一份报告）比，不读日志；锚点看到变小先软收紧，SAFE 看到才确认级 | 同左 |
| 加密分数 | 每笔裁决重写一次，比较后交换（prevHash） | 随批量裁决一起写 |
| gas | 测试网不计；记录每种报告的实际 gas | 主网前用批量摊薄 |

早先的对账设计是用 filterLogs 逐笔比对金库的 Transfer 与金库事件。审查发现三个问题：读取量随流量增长、回复大小上限没有文档、后台可以囤积 APPROVE 再一次执行让窗口读不完。资产守恒没有这些问题；它抓不到的情况（在 SAFE 落后的几分钟内，有人不经 fund() 直接转钱进金库，把被偷的部分补回来）写在 36_phase6.md 6.1。

## 5. RPC 与缓存

- **workflow：** 用 QuorumLens 一次读完；cron handler 的读取全部指定锚点区块
- **模拟器配额：** `cre workflow simulate` 预设就套用生产配额；`--limits none` 可以全关，但关掉后测出的数字不能对外说，仓库里禁止出现（D30）
- **链下服务：** 批量读用 Multicall3；订阅新区块与日志用 websocket，不轮询
- **Console：**
  - TanStack Query 的 query key 带区块号：同一个区块内同样的读取只发一次，新区块（约 2 秒）才失效
  - 列表页从数据库读，不逐行读链；详情页才读链核对
- **exchange-api：** 等裁决用订阅 VerdictRecorded，不轮询；断线后用 verdictOf 补查
- **多个 RPC：** 比赛版用 NOWNodes 加一个备用服务商，失败时切换；阶段 8 起可加 eRPC 做缓存、故障切换和限流。eRPC 关闭请求内容日志，诱饵相关的读取（Patrol、trap-sync）不经它
- **Trap 的 NOWNodes 调用（2026-10-07 实测）：** 只在有 NOWNodes 端点的链（Ethereum Sepolia）、诱饵被碰时每次 1 个 eth_getTransactionReceipt；延迟 p50 0.29 秒、p95 0.71 秒；整次 Trap 执行（含 CLI 启动）3.0 到 3.9 秒。NOWNodes 不可用时不阻挡收紧（审计 H2）
- **NOWNodes 用量：** 关 6 在方式 A 下是每个 DON 节点每个请求各调一次，节点数未知；阶段 5 起按「每秒请求数 × 节点数」估用量，先确认方案额度

## 6. 索引器与数据库

**索引器改用 Ponder**（services/indexer）：

- 写进同一个 Supabase Postgres，用自己的 schema `ponder_quorum`，角色 `ponder_svc`（对其他 schema 没有权限），直连或 session 模式
- 表：chain_events、cases 由 Ponder 的 schema 定义与维护；重组、补抓由 Ponder 处理
- **Ponder 只索引我方合约，不读诱饵清单**，也不索引 MockERC20 的 Transfer
- Ponder 自带的 HTTP 服务不挂 `/sql` 与 GraphQL，只在内网可达
- Console 不直接读这些表：Next.js 的服务端路由先验证人员登录（Supabase Auth，officer），再用只读的 `console_svc` 查
- 实时更新：服务端路由每个新区块推一次（server-sent events），不开放 Supabase Realtime 给这些表

**Supabase 的 quorum_index 只留：** traps、metrics、officer_signatures（仍按 20_data.md 的 RLS）。Realtime 只对 traps 与 officer_signatures。

**被碰的诱饵由 trap-sync 标记**（`trap_sync_svc`，只能改 traps 的状态栏位）。它只给 Console 显示用，收紧不靠它；各类诱饵的对法见 32_phase2.md 2.9。Timeline 的第一个点取 traps.tripped_tx，其后由服务端路由接 Ponder 的事件。

**容量（按每天 10 万笔提款估）：**
- 每笔约 5 个事件，加 Patrol 的事件，每天约 50 万行
- 比赛版：不用分区；D60 用实测推算
- 正式版：chain_events 按天分区（pg_partman，没有就用原生分区 + pg_cron），区块号用 BRIN 索引，保留 30 到 90 天，旧数据转 Parquet 放 S3
- 用 Supabase 付费版

## 7. 后台的排队与重试

- exchange-api 用 **outbox + pg-boss**：先写 withdrawals 行与一条任务，再由 worker 提交上链；崩溃不丢单
- 每个任务带幂等键（requestId）；失败指数退避重试；被额度桶拒绝也走退避
- 提交私钥：比赛版一把，交易串行发送（单一 nonce 管理）；路线图用多把私钥按 userIdHash 分片
- pg-boss 用直连或 session 模式；不开 LISTEN/NOTIFY 也能用
- exchange-api 对每个用户同时只送一笔请求（避免 ScoreConflict）；resubmit 带完整内容，RequestBoard 只存一个内容 hash
- sim-runner（方式 B）：SIM 模式只有一把广播私钥，广播串行；按优先级排队（Trap > Patrol > Cosign）；按 (txHash, logIndex) 去重，只在报告成功上链后才标记，失败的会重试

## 8. 比赛版做哪些

| 做 | 放路线图 |
| --- | --- |
| Cosign 改 LATEST、只留一个 handler；合约补三项检查（txHashOf、签名人、nonce 只付一次） | 批量请求 + Merkle 裁决 |
| RequestBoard 按 org 的额度桶、resubmit、积压检查 | 小额授权分级 |
| QuorumLens + Console 按区块缓存 | 数据库分区、S3 归档 |
| 索引器改用 Ponder；trap-sync 分开；角色分开 | eRPC、多私钥分片 |
| CUSUM 固定基线 + 检查点 + 金库分钟桶 | 基线定期离线重算 |
| 对账改用资产守恒（vault.fund()、ASSET_CHECKPOINT） | 深层溯源：链下搜索、CRE verify-edge 核实 |
| SCORE 比较后交换 | |
| exchange-api 用 outbox + pg-boss | |
| 每一步延迟分开实测 | |

pitch 被问吞吐量时的回答：CRE 的配额是每个 workflow 每 6 秒 10 个事件；我们在链上把它分给各家交易所，实测值见 D56（方式 A 才报）。要更高就做批量裁决（每批大小待实测，估计每秒约 60 笔），再加小额授权分级，大部分提款不必逐笔进 CRE。

## 9. 新增检查（已写进 40_verification.md）

| ID | 要求 | 阶段 |
| --- | --- | --- |
| D56 | 正常负载下不丢请求；后台淹没不了 Cosign | 3 |
| D57 | 每一步延迟都有实测 | 2、3 |
| D58 | CUSUM 检查点 + 重算等于逐分钟计算（含 PLANNED_OP 中途过期、中途登记） | 6 |
| D59 | Console 读链有缓存 | 2 |
| D60 | 一天的数据量在预算内 | 3 |
| D61 | 对账不读日志，读不到也不收紧 | 6 |
| D62 | 额度桶、resubmit、积压检查 | 3、6 |
| D63 | 重组与换 requestId 不会付两次 | 3 |
| D64 | 分数不会被并发请求覆盖；伪造请求不写分数 | 5 |
| D65 | 资产守恒检查点可信；误报不会直接冻结 | 6 |
