# 阶段 2：陷阱主轴（第 5 到 11 小时）

## 目标

红队从诱饵钱包发一笔测试转账（代币或原生 ETH），CRE 自动写一份确认级报告，链上完成：
- 温金库冻结
- 热金库额度清零，余额撤回冷钱包
- 警戒升到确认级（4）
- 冷钱包时间锁拉长
- 攻击者地址进共享名单

红队删掉后台日志，Console 显示不变。量出从转账到冻结生效的秒数。

这是视频 0:50 到 1:25 的画面，也是整个项目的主轴，优先级最高。

## 前提

阶段 1 完成；已决定方式 A（DON）或方式 B（sim-runner）。

## 任务

### 2.1 合约补全收紧动作

- QuorumReceiver：实现 SWEEP、QUOTA_ZERO、COLD_DELAY、THREAT；确认级动作包顺序见 10_interfaces.md 第 4 节；每个 action 发 `Tightened(caseId, kind)`
- ThreatRegistry：按 10_interfaces.md 3.7（按 evidenceHash 去重；拒绝 address(0) 和我方合约）；Receiver 的登记走 ConfigTimelock（部署脚本在构造时写好）
- forge 测试（确认级报告执行后逐项读状态）：
  - 温金库 `isFrozen` 为真，until 正确；温金库 execute revert `Frozen`
  - 热金库 quota 为 0、余额为 0，冷钱包增加同样金额；热金库 execute revert `AlertConfirmed`
  - `alert()` 为 4；冷钱包 delay 为收紧值
  - `isSuspect(attacker)` 为真
  - THREAT 同一 evidenceHash 送两次，count 仍为 1；不同证据同一地址，count 为 2
  - THREAT 的 suspect 为 0 时安静跳过（`ThreatSkipped`，不是 ActionFailed）；suspect 是我方金库地址时被 ThreatRegistry 拒绝（`ActionFailed`）；两种情况其他动作都照常执行
  - 确认级期间：非 manual 的 execute revert `AlertConfirmed`；温金库冻结期间 manual 也 revert `Frozen`；冻结到期后 manual 可以执行

### 2.2 交易所 A 的假后台（攻击目标）

apps/exchange-api（Bun + Hono），用 `exchange_a_app` 角色连接：

| 路由 | 用途 | 鉴权 |
| --- | --- | --- |
| GET /admin/risk-config | 返回 risk_config（含假门槛 5 qETH） | admin token |
| GET /admin/hot-wallets | 返回热钱包列表（label, chain, address, kind, status, balance）。私钥留在服务端 | admin token |
| POST /admin/hot-wallets/transfer | 被攻陷的签名路径：服务端解密并转出 1 qUSD。更大的金额直接拒绝 | admin token |
| GET /admin/whitelist | 白名单 | admin token |
| GET、DELETE /admin/audit-log | 查看与删除日志 | admin token |
| GET /health | 健康检查 | 无 |

每次 admin 调用都写 audit_log。admin token 就是红队「偷到」的凭证。**这个服务不能 import 任何诱饵清单或 Quorum 判断逻辑。**

### 2.3 布诱饵（services/decoy-admin，用 `quorum_svc`）

| 命令 | 做什么 |
| --- | --- |
| `wallets` | 生成诱饵 EOA：mint 50 qUSD、转 0.01 ETH；写 exchange_a.hot_wallets（随机 label，见 datasets/src/labels.ts）；生成 2 个诱饵收款地址，与真白名单一起按随机顺序重写 whitelist_addresses |
| `register` | 写 quorum_index.traps、`secrets/decoys.local.json`；生成 trap 的 config.staging.json（诱饵地址 `padHex` 补到 32 字节再 `hexToBase64`）；生成 DECOY_TAGS 写进 workflows/.env |
| `life` | 让几个普通地址偶尔**转入**诱饵钱包小额资金，留下「生活痕迹」。**诱饵钱包自己永远不转出**，所以它的任何转出、任何余额下降都一定是攻击者 |

验收：在 exchange_a.hot_wallets 里，诱饵 EOA 和两个真运维 EOA 字段结构完全一样，看不出差别；仓库里找不到诱饵的 label；whitelist_addresses 的 id 顺序不把诱饵排在最后。

### 2.4 Trap workflow（workflows/trap）

1. 两个 log trigger handler，共用一个回调；confidence `CONFIDENCE_LEVEL_LATEST`（收紧不等 finalized）；注意每个 trigger 最多 5 个地址、每个 topic 位置最多 10 个值：
   - A：qUSD、qETH 合约的 Transfer，topic1（from）= 诱饵钱包
   - B：同样两个合约的 Transfer，topic1（from）= 我方热金库或温金库，topic2（to）= 诱饵收款地址。意思是：钱真的从我们的金库付到了诱饵地址，说明有人借用了白名单。**陌生人转小钱给诱饵地址不触发**，不然谁都能远程冻结交易所
2. 回调：
   - `getTransactionReceipt` 重读，确认这条 log 存在
   - 判定类型与 suspect：
     - A：suspect = Transfer 的 to（钱被转去的地址）；to 是 address(0) 或我方合约时 suspect 为 0
     - B：suspect = 0，只收紧不标记。攻击者自己的地址此时未知
   - 算 caseId、evidenceHash、fingerprintHash（金额区间：对数分桶，边界放 config）
   - 组确认级动作包；`issuedAt` = 触发区块的区块头时间（headerByNumber，已在 Trap 的读取预算里），不用 runtime.now()
   - `writeReport`（gasLimit 用 config 的 reportGasLimit）；`txStatus` 或 `receiverContractExecutionStatus` 不成功就打 error 日志
3. 不读 Supabase，不调用 exchange-api

验收（模拟）：`cre workflow simulate workflows/trap --broadcast --evm-tx-hash <红队那笔> --evm-event-index <n>` 后，2.1 的状态检查全部通过；同一笔再模拟一次，状态不变。

### 2.5 Patrol 的诱饵原生币检查（从阶段 6 提前）

ETH 转出没有 Transfer 事件，Bitget 的测试转账里就有原生币。

- 用 patrol 的 `decoys` handler（cron 60 秒）。诱饵地址从 secret `PATROL_DECOYS` 读；余额用 QuorumLens.patrolView 一次读完（锚点一次、锚点 − N 一次）
- 读取都指定锚点区块（latest − ANCHOR_LAG）。S9 证明读不到锚点 − N 时，拿掉第 2 条，只留 floor 检查，并把这个缺口写进 proposal 边界。**不能把诱饵余额写上链**（例如存进 PatrolState）：链上公开，余额什么时候变就等于告诉别人哪个是诱饵
- 对每个诱饵 EOA 做两个检查，任一成立就判定确认级：
  1. **余额低于下限：** `balanceAt(锚点)` < config 里的 floor。floor = 布诱饵时的初始注资；诱饵只收不转，余额只会往上走，所以永远不该低于 floor。这一条不依赖时间窗口，不会漏
  2. **窗口内下降：** `balanceAt(锚点)` < `balanceAt(锚点 − N)`，N 取实际执行间隔的 3 倍以上（方式 B 下 simulate 一次可能超过 60 秒，按 sim-runner 记录的实际间隔算），用来抓「先被转入、再被转走、但仍高于 floor」的情况
- 包括只付了 gas 的交易，都会让余额下降
- suspect = 0（不扫交易就不知道去向，阶段 6 再补）
- caseId 用 (orgId, chainId, 诱饵地址, 发现时区块号)
- 已知漏洞：攻击者只转走「生活痕迹」带进来的那部分，而且发生在窗口之外，两条都可能抓不到。把 life 转入的金额控制得很小，并写进 proposal 的边界

### 2.6 运行方式

- **方式 A：** `cre workflow deploy` + `activate`；Receiver 的 workflow owner / name 白名单在部署时写好
- **方式 B：** services/sim-runner（`quorum_svc`，可以读 quorum_index.traps）。SIM 模式只认一个 simOperator，所有 `--broadcast` 共用同一把私钥，所以**广播一次只跑一个**（除非 S2 证明 CLI 会正确处理 nonce）；排队用优先级：Trap > Patrol > Cosign，Cosign 再多也挤不掉 Trap。去重键 (txHash, logIndex) 只在报告成功上链之后才标记，失败的会重试：
  - trap：S3 证明 `--listen` 可用，就常驻 `simulate workflows/trap --broadcast --listen`；否则自己用 viem 订阅诱饵相关的 Transfer（地址从 traps 读），对每笔调用 `simulate --evm-tx-hash … --evm-event-index … --non-interactive --broadcast`
  - patrol：每 60 秒调用一次 `simulate workflows/patrol --non-interactive --broadcast`
  - 记录每次调用的起止时间，写 metrics

### 2.7 红队 CLI（services/redteam，用 `exchange_a_app` 和 admin token）

| 命令 | 做什么 | 预期 |
| --- | --- | --- |
| `recon` | 调 admin 路由，打印风控配置、热钱包、白名单 | 看到 5 qETH 门槛和三个带私钥的 EOA |
| `probe` | 用诱饵 EOA 转 0.84 qUSD 到攻击者地址（模仿 Bitget） | 触发 Trap |
| `probe --native` | 用诱饵 EOA 转 0.001 ETH | 60 秒内由 Patrol 触发 |
| `race` | probe 之后立刻用所有能想到的路径（直接 execute、admin 伪造提款、用三个 EOA 私钥转账）尽量多拿钱，直到 Trap 收紧生效 | 记录 `extractable_after_trigger`：热金库与温金库一分都出不去；能拿走的只有三个 EOA 本来就有的小额 |
| `wipe` | 删 audit_log | Console 不变 |
| `drain` | 直接调用热金库 execute | revert |
| `status` | 读链上冻结、quota、余额、警戒、名单 | 打印给录屏用 |

每个命令打印时间戳，录视频用。

### 2.8 时间测量

- `scripts/measure-trap`：t0 = 诱饵 Transfer 所在区块时间，t1 = FreezeSet 所在区块时间；写 `metrics(name = trap_to_freeze_seconds, source = testnet_measured)`，另记从 probe 发出到 Freeze 上链的墙钟时间
- 代币 probe 跑 3 次、原生币 probe 跑 2 次；记录中位数和最大值
- 每次之间用 `reset-demo` 恢复

### 2.9 Console：登录、Traps、Control status

apps/console（Next.js，英文 UI，专业控制台风格）：

| 页面 | 显示 | 数据 |
| --- | --- | --- |
| Login | Supabase Auth email OTP；不是 officer 的账号进不去 | Supabase Auth |
| Traps | 每个诱饵：类型、链、余额、上次检查、状态（armed / tripped）、被碰的交易链接 | quorum_index.traps（由 trap-sync 更新）+ viem 读余额（Multicall3 一次读完） |
| Control status | 警戒等级与到期倒数、温金库冻结倒数、热金库 quota、冷钱包 delay、Receiver 模式（PROD / SIM）、白名单 workflow | 全部 viem 直读合约 |
| 事件流 | 最近的 Tightened、ThreatAdded | ponder_quorum.chain_events，经服务端路由（先验证 officer）每个新区块用 SSE 推一次 |

指标卡片显示 trap_to_freeze_seconds，并标 `testnet measured`。

读链：TanStack Query 的 query key 带区块号，新区块到达才失效；Control status 的全部读取经 Multicall3 合成一次（42_performance.md 第 5 节）。

**trap-sync（services/trap-sync，`trap_sync_svc`）：** 从 quorum_index.traps 读诱饵清单，只负责 Console 的显示，收紧完全不依赖它。各类诱饵怎么标记被碰：

| 诱饵类型 | 看什么 | tripped_tx | case_id |
| --- | --- | --- | --- |
| 代币诱饵钱包 | 这些地址转出的 Transfer | 那笔转出 | (orgId, chainId, txHash, logIndex)，同 Trap |
| 原生币诱饵钱包 | 每个区块读余额（Multicall3），找到余额下降的区块 b | 余额下降那个区块里从诱饵发出的交易 | Patrol 用「发现时的区块号」，trap-sync 算不出同一个数：在 b 之后 200 个区块内找 Tightened 事件，caseId 等于 keccak(orgId, chainId, 地址, b′) 的那个 |
| 诱饵账户 | WithdrawalRequested 的 userIdHash 等于 ref | 那笔提交交易 | (orgId, requestId)，同 Cosign |
| 诱饵收款地址 | WithdrawalRequested 的 to 等于 ref，而且之后同一 caseId 有 Tightened | 那笔提交交易 | 同上 |
| 隐藏门槛、诱饵凭证（P2） | 不标记，Traps 页显示 n/a | | |

resubmit 会让同一个 requestId 的事件出现不只一次，按 requestId 去重（Ponder 的 cases、exchange-api 也一样）。每分钟更新 last_checked。trap-sync 自己读诱饵余额，不经共用的 RPC 代理（eRPC），免得请求日志里出现诱饵地址。

**延迟分段记录：** 每次 probe 都把 42_performance.md 第 2 节的 lat_include、lat_trigger、lat_exec、lat_report 分别写进 metrics（D57）。

## 设计一致性（必须通过）

D01、D02、D03、D06（转入不触发部分）、D08、D09（只延长部分）、D10（Trap 用 LATEST 的部分）、D12（不含 Merkle）、D18、D28（hot_wallets 部分）、D29（加上 BUNDLE）、D30（trap、patrol）、D32、D33、D36、D45、D47、D57（Trap 部分）、D59

场景脚本：`scenes/s1_trap.sh`、`scenes/s2_wipe.sh` 在本阶段写好（视频也用）。

## 阶段 2 完成标准

- [ ] `recon → probe` 之后无人操作，链上状态全部变成收紧状态（2.1 清单逐项读状态通过）
- [ ] `probe --native` 也能触发
- [ ] 同一事件处理两次，状态不变
- [ ] 陌生地址转小钱给诱饵收款地址，不触发
- [ ] `wipe` 后 Console 不变；`drain` revert
- [ ] 停掉 indexer（Ponder）并清空 ponder_quorum 的表后，Control status 仍然正确（D47）
- [ ] Control status 打开一分钟，Console 发出的 RPC 调用 ≤ 区块数 × 2（D59）
- [ ] `race` 记录 extractable_after_trigger（D45）
- [ ] trap_to_freeze_seconds 有实测
- [ ] 打包后的 console 前端、exchange-api 里找不到任何诱饵地址或诱饵账户；exchange_a 里诱饵本来就存在（诱饵 EOA、诱饵账户），但找不到任何「这是诱饵」的标记
- [ ] 跑 `reset-demo`，为阶段 3 准备干净的金库
- [ ] `pnpm verify:design --phase 2` 全过；REV 没有未处理的 High
- [ ] STATUS.md 更新；方式 B 时注明视频要说「CRE 模拟环境」
