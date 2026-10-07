# 49 可视化数据：时间序列、等级、每栋建筑与每个诱饵

> 后端：`services/indexer`（Ponder）在 `/history` 提供链上事件与状态快照的时间序列，经一源服务器
> `apps/observatory/serve.ts` 代理（与 `/rpc`、`/bridge`、`/decoygen` 同一个 origin）。
> 全部是这条链上已经公开的数据（source = testnet measured）；不含诱饵清单、不含明文 sealedReason、不含当前门槛（规则 2）。
> 诱饵生成器（`/decoygen`，docs/48）是另一条独立的实时线，和攻击按钮无关。

## 1. 启动

`cd apps/observatory && pnpm build && bun serve.ts`。端口没在用时，serve.ts 会起 indexer：

```bash
node node_modules/ponder/dist/esm/bin/ponder.js start --schema ponder_quorum -H 127.0.0.1
```

在 `services/indexer` 下执行，环境变量：`DEPLOY_NAME=base-sepolia-fork`、`PONDER_RPC_URL_1=http://127.0.0.1:8545`、`PONDER_SNAPSHOT_EVERY=1`。

- 本地数据库是 PGlite（`services/indexer/.ponder/pglite-<代码哈希>`，不进 git，可以从链上重建）。目录名跟着 indexer 代码（config、schema、handler）的哈希走，所以拉了改 indexer 的代码后会自动建一个新库重新索引（fork 上约 3 分钟），不会再碰到 Ponder 的 `MigrationError`；旧目录可以删
- 公开 Base Sepolia：`DEPLOY_NAME=base-sepolia`，RPC 换成公开或 NOWNodes 端点，`PONDER_SNAPSHOT_EVERY=30`（约 1 分钟一个快照），可选 `DATABASE_URL` 接 Postgres。代码不用改
- 已知限制：bridge 的 `/reset`（evm_revert）回退的区块数超过 Ponder 已认定 finalized 的区块时，indexer 要删库重建

## 2. 路由（全部 GET；`org` = A、B…）

| 路由 | 返回 |
| --- | --- |
| `/history/meta` | chainId、orgs、series 名单、最后一个事件区块、最后一个快照区块 |
| `/history/events?fromBlock&toBlock&contract&event&org&limit\|last` | 原始事件，旧到新；`last=N` 取最新 N 条 |
| `/history/series/<name>?org&fromBlock&limit\|last` | 一条命名的序列（见第 3 节） |
| `/history/series/snapshots?org&fromBlock&limit\|last` | 每个区块每个 org 的状态快照 |
| `/history/counts?org` | 每种事件的总数与最近 24 小时（链上时间）数量；用来替代 UI 里写死的探测、攻击、广播次数 |
| `/history/stream` | SSE，`event: chain`，每条新索引到的事件推一次；`id` = `区块:logIndex`，支持 `Last-Event-ID` 或 `?after=` 续接；15 秒没有新事件推一次 `event: ping` |

事件行的格式：`{id, block, time, tx, contract, tier (receiver|desk|hot|warm|cold|null), org, event, caseId, args}`。金额是基础单位的十进制字符串（qUSD 6 位、qETH 18 位）。

## 3. 序列

| 名字 | 事件 | 用在 |
| --- | --- | --- |
| alert | AlertSet(level, expiresAt) | 交易所岛的等级 0 到 4 |
| freeze | FreezeSet(vault, until) | 热库、温库的冻结倒数 |
| tighten | Tightened、ReportProcessed、ActionFailed、ActionStale | CRE 核心的报告与失败率 |
| verdicts | VerdictRecorded、Downgraded、Held、Released、Cancelled、Skipped、UserCancelled | 提款裁决 |
| pings | Ping | Patrol 存活 |
| outflow | Executed、Swept、ProtectedRelease | 热库、温库的流出 |
| quota | QuotaRefilled、QuotaZeroed、TopUp、Funded | 额度 |
| cold | DelayRaised、DelayLowered、Queued、QueuedExecuted、QueuedCancelled | 冷库 |
| cusum | PatrolStateUpdated(vault, token, minute, S, alarm, gap) | CUSUM 曲线，S ≥ h 为报警 |
| assets | AssetCheckpoint、AssetResetQueued、AssetResetExecuted、PlannedOpRegistered | 资产守恒 |
| threats | ThreatAdded | 威胁登记、衍生边 |
| requests | WithdrawalRequested | 提款请求 |
| decoyCommit | RootSet、ThresholdCommitted、ThresholdRevealed | 承诺根、叶子数、过去的门槛（揭晓后才有） |
| config | ConfigQueued、ConfigExecuted、ConfigCancelled | 时间锁 |
| officer | ManualQueued、ManualExecuted、QueuedCancelled | 人员动作 |
| snapshots | 状态快照（不是事件） | 余额、额度、上限、等级、冻结时间、冷库延迟、全网确认威胁数 |

## 4. 等级与可信度

| 数值 | 范围 | 来源 | 谁能看 |
| --- | --- | --- | --- |
| 等级 | 0 到 4（Normal、L1、L2、L3、CONFIRMED） | snapshots.alert、alert 序列 | 公开 |
| CUSUM | S 与 h（5000），alarm | cusum 序列 | 公开 |
| 第二数据源 | match / unavailable / contradiction | bridge `/attack/status` 的 verified 步骤 | 公开（只在攻击时） |
| 全网威胁 | 数量 | snapshots.activeConfirmed、threats 序列 | 公开 |
| 账户分数 λ | milli-nats，L1 2303、L2 4605、L3 6802 | 链上只有加密的分数；VerdictRecorded 的 sealedReason | 只给人员（解密），地图上不出现 |
| 诱饵不可分辨 | AUC 区间在 [0.35, 0.65]、honeyword ≤ 0.35 | `/decoygen/inventory` summary.gate | 守方 UI，source = assumed |
| 诱饵先被挑中的概率 | 每种攻击策略 0 到 1 | `/decoygen/inventory` summary.pFirst | 守方 UI，source = assumed |

## 5. 每栋建筑

| 建筑 | 实时（snapshots） | 序列 | 计数（counts） |
| --- | --- | --- | --- |
| 交易所岛 | alert、alertExpiresAt | alert、verdicts、requests、threats | 请求、裁决、威胁、收紧 |
| 热库 | hot 的余额、额度、上限，hotFrozenUntil | outflow、quota、cusum、freeze | Executed、QuotaZeroed |
| 温库 | warm 的余额、额度、上限，warmFrozenUntil | outflow（Swept）、freeze | Swept |
| 冷库 | cold 的余额、delay | cold | DelayRaised |
| CRE 核心 | activeConfirmed | tighten、pings | ReportProcessed、ActionFailed、ActionStale |
| NOWNodes 塔 | 最近一次判定（bridge） | 只在攻击时有 | 无 |
| Patrol 蜂 | 无 | pings、cusum、assets | PatrolStateUpdated、AssetCheckpoint |
| 威胁登记 | activeConfirmed | threats | ThreatAdded |
| 诱饵承诺 | 无 | decoyCommit | RootSet、ThresholdCommitted、ThresholdRevealed |

## 6. 每个诱饵（只用 tag，不用地址）

- 链上的陷阱诱饵（示例诱饵）：地图上只显示「被碰了」与之后的收紧链（同一 caseId 的 Tightened、AlertSet、FreezeSet、QuotaZeroed、Swept、ThreatAdded）。不显示地址或名次
- 生成器的诱饵：`/decoygen/inventory` 与 `/decoygen/stream`（docs/48 第 7 节），状态 pool / online / retired / burned，和攻击按钮无关

## 7. 攻击按钮这条线

`POST /bridge/attack` 在 fork 上产生真实交易，CRE simulate --broadcast 写报告；indexer 索引到之后从 `/history/stream` 推出来。地图用 bridge 的 `/attack/status` 驱动叙事步骤（扫描、探测、核实），用 `/history/stream` 的真实事件驱动收紧动画与数字，用 `/history/series/snapshots` 画前后对比。
