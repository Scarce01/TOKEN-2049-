# STATUS（Claude Code 每完成一个任务就更新）

## 当前阶段

**2026-10-07：** `integrate/all-features`（protection-layer + R7、create-detect-decoy 的三个功能提交、审计修复、CRE verify-edge 链上溯源、模拟链端到端测试）经用户要求**直接推到 main，没有走 PR**。测试与审计结果见 [AUDIT_2026-10-07.md](AUDIT_2026-10-07.md)，剩下的工作见 [TODO.md](TODO.md)。

阶段 1 代码完成（beta 仓库，不是比赛仓库）。阶段 2、3 的合约、workflow、后台、Console、user-app 代码也已写好。
测试网部署、CRE simulate、E2E 场景等待：`cre login`、Base Sepolia 测试币、3 位人员邮箱。

`pnpm verify:design --phase 1`（2026-10-05，local）：fail 0，not-yet 2（D28 种子验收、D30 DET，都需要测试网与 CRE 登录）。

| 部分 | 状态 | 证据 |
| --- | --- | --- |
| 合约 v0（阶段 1 到 3 的合约部分，含 SWEEP、QUOTA_ZERO、COLD_DELAY、THREAT、VERDICT、人工慢车道、refill、topUp） | 完成 | forge 73 个测试全过（含 5 个不变量 I1、I2、I3、I6、I7） |
| packages/shared | 完成 | 15 个测试；EIP-712、txHash、workflow name、OfficerAction 四个向量与 forge 一致 |
| workflows trap / cosign / patrol | 完成（未 simulate） | 27 个 WU 测试；三个都能 `cre workflow build` 编译成 WASM |
| Supabase（云端 qqummzczdiatpagdvkge） | 完成 | 3 个 migration 已推送；22 个权限测试全过 |
| exchange-api、decoy-admin、datasets、indexer、trap-sync、sim-runner | 完成 | 种子流程在 Anvil 跑通；Ponder 在 Anvil 索引 172 个事件 |
| Console、user-app | 完成（未连测试网） | `next build` 通过 |
| verify:design | 完成 | reports/design-conformance.md |
| 红队脚本 | scan / attack | `pnpm redteam:scan` 只读本地 `GET /admin/hot-wallets`（20 行；字段 label, chain, address, kind, status, balance；没有 privateKey，也没有 decoy / trap / honeypot）。排序规则是 kind=eoa 且 qUSD 余额至少 1，余额高的在前。探针走 `POST /admin/hot-wallets/transfer`，私钥留在 exchange-api。不读 secrets、quorum_index、workflow 配置 |
| Round 3.5 集成演示 | `pnpm demo:e2e` 一条命令 | Ethereum Sepolia 新组织（resetBlock 11854730，receiver `0x223f22DA260598E914DBbb7828a1807017266596`，hot `0xD793dB0588B4AbcB3aED729C31d3D9f268BEc7Ae`）。起点 alert 0、hot quota 5,000 qUSD、warm 未冻结、攻击者收款地址不是 suspect。扫描 20 个钱包后按余额排出前三名，各收到一笔 1 qUSD 探针，其中一笔触发 Trap（诱饵的 label、名次与探针交易只记在 secrets/，规则 2；审计 2026-10-07 H3）。CRE 报告 `0xd0346dcf01df2d6015a4c07cb64b56496497f92d5902317ced40ab5354da1896`（区块 11854759，NOWNodes 与 Trap A 都通过）。之后 alert 4、quota 0、warm 冻结、收款地址 suspect。批准报告 `0xb45f92592c5d90737b2b16a031388c2bc34f2cffa327fe0839757439ba2f1e4e`。500 qUSD 热钱包 execute `0x12d4c40665ef3733c97535525e2fae97467a9590dfb2b2755e67024a854e2da1`（区块 11854763）失败，重放 data `0x685a21ef`（AlertConfirmed）。仍用 PGlite。公开 Anvil submitter 持不住 ETH，演示用 EIP-7702 由部署者付 gas，RequestBoard 看到的仍是原 submitter |
| 阶段 4 到 6 合约（DecoyCommit、PatrolState、ThreatRegistry 要求证明、SCORE 比较后交换、门槛承诺与揭示） | 完成 | forge 91 个测试全过（阶段 5、6 新增 18 个） |
| 阶段 5 Cosign（SPRT 分数、隐藏门槛、关 5 美元、关 6、关 7） | 完成（未 simulate） | 41 个 Cosign WU 测试，含 D50 定点数对浮点参考 |
| 阶段 6 Patrol（epoch、quota、reconcile 三个 handler） | 完成（未 simulate） | 19 个 Patrol WU 测试；三个 workflow 仍可编译成 WASM |
| decoy-admin commit（加盐 Merkle，补到 2^k） | 完成 | Anvil 上实测 10 个诱饵、16 片叶子，证明写进 trap / cosign 配置；叶子与 DecoyCommit.leafOf 有共用向量 |
| Console Timeline 页 | 完成 | `next build` 通过 |
| 离线分析 | 完成 | D39 公式 66.02% 对 10 万次模拟 66.07%（差 0.05 个百分点）；D52 三种策略各 2,000 次 |

`pnpm verify:design`（全部阶段，2026-10-05，local）：fail 1（D28 诱饵 AUC，见「待决定」），其余未通过的都是 not-yet（需要测试网或 CRE 登录）。

## CRE 运行方式

- [ ] 方式 A（DON 部署）  - [ ] 方式 B（sim-runner + SIM 模式）
- 决定依据：

## 合约地址（Base Sepolia）

| 合约 | 地址 | 部署区块 |
| --- | --- | --- |
| | | |

## 外部地址

| 项目 | 值 | 来源 |
| --- | --- | --- |
| ETH/USD Price Feed（Base Sepolia） | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`（8 位小数，heartbeat 1200 秒，偏差 0.15%） | Chainlink 文档与链上读取，2026-10-05 核对 |
| ETH/USD Price Feed（Ethereum Sepolia，备用） | `0x694AA1769357215DE4FAC081bf1f309aDC325306`（8 位，3600 秒，1%） | 同上 |
| KeystoneForwarder（Base Sepolia） | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | CRE 文档，链上有合约代码；还要用 `cre workflow supported-chains` 再对一次（需要登录） |
| MockKeystoneForwarder（Base Sepolia） | `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5` | 同上 |
| MockKeystoneForwarder（Ethereum Sepolia，备用链） | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` | CRE 文档；31_phase1.md 没列，换链时要用这个 |

## Spike 结果

| # | 结论 | 备注 |
| --- | --- | --- |
| S1 | | |
| S2 | | |
| S3 | | |
| S4 | | |
| S5 | | |
| S6 | 可行（部分） | Base Sepolia 有 ETH/USD feed（见上表），公开 RPC 读 latestRoundData 正常；CRE 的 callContract 读取要等 simulate |
| S7 | | |
| S8 | | 方式 A 才需要 |
| S9 | | 实测 filterLogs 能读回几笔（BATCH_LOGS）、patrolView 回复大小；能否读 latest − 40、latest − 150 的状态 |
| S10 | | 超过 log trigger 限流的事件是丢掉还是排队（方式 A） |
| Bitget 回测 | 完成 | 钱包与 8 笔被盗交易见 docs/research/bitget_2026-09.md（多来源核对）；基线与逐分钟序列在 datasets/public/；analysis/bitget_cusum.ts；结论见「待决定」 |
| S7 NOWNodes | 完成 | 2026-10-06：Start 计划没有 Base Sepolia，`https://base-sepolia.nownodes.io` 是 nginx 404。`https://eth-sepolia.nownodes.io` 的 `eth_chainId` 是 `0xaa36a7`。Ethereum Sepolia 整套合约已广播，地址在 `deployments/ethereum-sepolia.json`。一只诱饵转出 1 qUSD（交易哈希只记在 secrets/，规则 2；审计 2026-10-07 H3）。`cre workflow simulate ./trap --target staging-settings --broadcast` 日志：`nownodes status=1 logs=1`，`trap A tripped`，报告交易 `0x8a16e65f11ebcf65ee21b500af784bf567e680e47fa4677c3d82a7918547b5e5`。链上 alert=4，热库 qUSD 额度从 5000000000 变成 0，温库冻结，ThreatRegistry 把收款地址标成 suspect。补一笔有效 APPROVE 后，热库 `execute` `0xf3dffa31fe9476ff0822aa0357c2a3eac756312e45da52d8c84298beb1ae2fe9` 回滚 `AlertConfirmed`。本地没有数据库，`wallets`/`register` 的写表被跳过，staging 配置由 `configs` 从 `secrets/decoys.local.json` 生成 |
| BigQuery H0 | 完成 | 项目 stock-data-484313；每次查询约 17 到 25 GB（免费额度 1 TB / 月）；结果在 datasets/public/h0_binance_2026-09.json，14 个指标写进 metrics |
| CRE 配额 | | `cre workflow limits export` 的结果（verify/cre_limits.json）；现场问 Chainlink mentor 比赛是否放宽 |
| pg_partman | 可用 | Supabase Cloud 上 `pg_available_extensions` 返回 pg_partman 5.3.1（2026-10-05） |
| S4（部分） | WASM 编译通过 | noble hashes / curves / ciphers 与 seal 都能被 `cre workflow build` 打包进 WASM；运行期结果要 simulate（需要登录）才能确认 |

## 实测指标

| 指标 | 值 | 来源类型 | run_id |
| --- | --- | --- | --- |
| trap_to_freeze_seconds | | testnet_measured | |
| request_to_verdict_seconds | | testnet_measured | |
| lat_include / lat_trigger / lat_exec / lat_report / lat_execute | | testnet_measured | |
| cosign_queue_delay_p95（load-normal --rate 1.0） | | testnet_measured | |
| sim_runner_max_rate（方式 B） | | testnet_measured | |
| rows_per_day_estimate / db_mb_per_day_estimate | | testnet_measured（按比例推算） | |

## 待决定

- **Receiver 合约大小：** 47 第二阶段后 runtime 21,431 bytes，离 24,576 上限约 3.1 KB。R7 定向冻结或再加功能前，要先把人员动作（HOLD、CANCEL、MANUAL、LOWER_ALERT）拆到独立合约
- **R7 受保护车道（47，D112）：** 已做，默认关（见设计变更）。还要团队决定：(1) proposal 第 4 节的冻结语义回写；(2) Trap 的 FREEZE 或 QUOTA_ZERO 要不要同时把车道额度 pBudget 清零（现在 Trap 关不掉车道）；(3) 车道放行要不要也受 R8 每小时、每天上限约束（现在不受）；(4) R7 还没进不变量 handler
- **46 两类预算与信任等级（TRUSTED / GENERAL、T1 到 T3）：** 3.6 没做。需要 KeyRegistry 记钥匙年龄、金库按类别分桶、Patrol 分别补充（跨三个合约）；先定 ADDRESS_MATURE_AGE 与 KEY_TRUST_AGE（46 第 21 节建议 7 天 / 7 天，演示 3 分钟 / 1 小时）。seenAt 已在链上，成熟地址随时可以算
- **47 风控框架（docs/47_risk_framework.md 第 8 节）：** L_pub（建议 $4M / 1,300 ETH，演示 5,000 qUSD / 4 qETH）与 D_LARGE（建议 1 小时）；R2 什么时候从 shadow 改 enforce；第二阶段的合约改动（R2 合约 floor、定向冻结、三层额度桶、单笔 HOLD）。第一阶段已实现，等团队确认是否保留

- **CUSUM 抓不到 Bitget 式的「几笔巨额」（Bitget 回测，public_onchain）：** 用 Bitget 6 自己事发前 4 周建基线，2026-09-21 到 09-24 22:00 逐分钟跑 Patrol 同一套 CUSUM。h 从 5 到 40 都没有在事发后报警；平时误报 h = 5 时每天 1.86 次、h = 12 时 0.27 次。原因：按分钟取 log2 后，3,475 万美元那一分钟 z 只有约 1.7（σ 因大量空闲分钟而很大），8 笔被盗转账分散在 2.5 小时，中间的空闲分钟把 S 拉回 0。proposal §6 F 的 CUSUM 是为「慢慢抬高」设计的，结构上看不到这种模式。要不要加一条「单分钟流出超过 H0 p99.99 就软收紧」的规则（或对单笔金额做检查）？这是新规则，不自己加。**2026-10-07 已加（chunloong 要求）：** CUSUM 的尖峰规则（36_phase6.md 6.3），见设计变更；默认不启用，spikeMax 由各部署的 config 设定
- **额度桶在 Bitget 当天的效果（public_onchain r_max + 假设的 C = 5 × r_max）：** 7 笔被盗转账里 6 笔单笔超过 C，会转人工而不是走快车道；若攻击者拆成小笔，到 19:05（Bitget 发现）快车道上界 1,690 万美元 + 2,435 ETH，实际被盗 4,760 万美元 + 7,131 ETH；到 19:16 上界 3,230 万美元 + 4,667 ETH。C 的倍数要团队定
- **Bitget 的测试转账（18:31）来自真实热钱包 Bitget 6，不是诱饵：** 视频与 pitch 不能说「Quorum 在 18:31 就会抓到」，只能说「如果攻击者先试的是诱饵钱包，就会在那一刻收紧」。Bitquery 提到被盗交易的 gas limit 固定为 100,000 / 200,000，正常提款约 63,000，可能是另一个特征（未验证、未实现）

- **用 H0 重估 λ（BigQuery，Binance 2026-09，source = public_onchain）：** 「新收款地址」在真实提款里占 40.6%（稳定币）/ 61.4%（ETH），假设攻击者总用新地址，λ = ln(1/0.406) ≈ 900（与 proposal 的假设值一致）、ETH 约 490。「贴着假门槛」在真实提款里只有 0.0044%（稳定币）/ 0.026%（ETH），比 proposal 假设的 0.5% 少得多，按 P(s|H1) = 50% 算 λ ≈ 7,560，单一信号就会到 L3（全部 PENDING）。要不要改 λ？没决定前维持 4605
- **H0 只来自 Binance：** 9 个已核对的交易所地址里，2026-09 只有 Binance 14/15/16 有流出（Coinbase、OKX、Kraken 那几个地址没有），H0 等于「Binance 的提款分布」。另外只排除了这 9 个地址之间的转账，Binance 自己转去其他冷钱包的大额调拨可能还在尾部（p99.9 以上）
- **演示的比例换算是假设：** 真实 Binance 14 每分钟流出 p99 约 200 万美元，演示热金库 r_max 是每分钟 1,000 qUSD，所以 CUSUM 基线的 μ 整体平移 log2(1000 / 2,001,780) ≈ −10.97（ETH −11.52），σ 不变。这个换算只为了让演示规模的流量落在同一个 z 尺度上，不是测量结果

- ~~**溯源标准答案不完整**~~ 已解决（2026-10-06，PR #9）：种子集 A（只用 `0x47666`）与 B（Verichains 的 7 个）分开报告，种子本身不算进分母。只用一个种子，1 跳就找到 41 个、3 跳找到全部 51 个，所以「低估第一跳」不成立。详见 docs/research/tracing_backtest.md
- **Bitget 回测缺地址：** 公开来源没有完整的 Bitget 热钱包地址，6.6 的 Bitget 当天 CUSUM 回测与最坏损失对比做不了（按文档「找不到可信标注就不做，不要猜地址」）。可以只用已核对的时间线做图
- **D44 误报率：** 合成流量算出 A 5.8%、B 12.0%，已确认主要是合成模型的问题（没有再充值）。用 BigQuery 的真实 Binance 提款按同一比例换算后，关 7 在 L0 让约 **每万笔 14 笔**（0.14%）转 PENDING；L1 账户上限减半时约 0.6%（稳定币）/ 0.26%（ETH）。按 Binance 的日流量（约 21,800 笔）约每天 30 笔人工复核。这些写进 metrics（public_onchain，比例换算是假设）

- **D28 诱饵 AUC 没达标（合成数据，source = assumed）。** analysis/decoy_auc.py：全部 110 个账户里，余额本身就能分出诱饵（诱饵本来就放在头部，这是 proposal 6 A 的刻意设计）；只在攻击者会挑的前 60 名里比，逻辑回归 AUC 0.706、梯度提升 0.578，bootstrap 95% 区间上界 0.884，目标 ≤ 0.65。两件事要团队决定：(1) 只有 10 个诱饵，区间本来就很宽，「上界 ≤ 0.65」用单一批诱饵几乎不可能达到，要不要改成「多批重新生成后的平均 AUC」或加大样本；(2) 点估计 0.706 表示生成方式仍有破绽（推测是 regDays / activity 直接按头部账户 ±20% 抖动，与余额相关），要不要改 decoy-admin 的抽样方式。没决定前 D28 维持 fail，不改断言
- **诱饵生成器（docs/48_decoy_generation.md，2026-10-07）：** 新生成器在 1,000 个合成账户上 8 / 8 过双侧门槛（AUC 区间上界最大 0.613），但演示用的 100 个账户只有 19 行在吸引区段里，门槛过不了、ρ_max 15% 下也只放得下 1 个诱饵。要决定：(1) D28 改用新生成器的口径（区段并集、双侧 [0.35, 0.65]、honeyword ≤ 0.35）还是维持旧口径；(2) 演示交易所的账户池要不要扩到约 1,000 个；(3) 生成器的计划写在 `secrets/decoygen/`（不进 git，与 decoys.local.json 同一目录），规则 2 只点名了 decoys.local.json，要不要把这个目录也列进去；(4) 计划落地（写 exchange_*、登记 Trap、ConfigTimelock 提交新根）会换掉示例诱饵所在的根，什么时候做；(5) 门槛与 ρ_max、预备期 2 期、每月轮换 20% 都是假设值
- SAFE 区块标签用 -4（go-ethereum 惯例），SDK 只公开了 finalized（-3）；spike S9 要在 Base Sepolia 上确认
- 关 6 的第二个数据源：S7 已确认 NOWNodes 只有 Ethereum Sepolia、没有 Base Sepolia，所以 Base 上关 6 仍只做「价格过期」，「数据源一致」维持 waived（D14.6）
- **更正（2026-10-07 实测）：** NOWNodes 有 Base Sepolia 节点（`base-sepolia.nownodes.io`），是我们的 key 没开权限（回复「You do not have access to this node」）；同一个 key 能用 eth-sepolia 与 base 主网。要在 NOWNodes 后台给 key 开 Base Sepolia，之后在 `workflows/trap/src/logic/nownodes.ts` 的 NOWNODES_URL 加 84532，公开链上的 Trap 才有真的第二数据源。本地 fork 上的交易只在本机，任何公开节点都看不到，所以 fork 上第二数据源一律显示「不适用」，不能显示为一致（规则 8）
- CUSUM 报警目前只把补充量减半；「再加一个独立信号就升 L1」（D55 的第二部分）还没做，需要先定义哪些信号算独立（PENDING 51、指纹命中）

- exchange-api 的排队：文档写 pg-boss；现在用 withdrawals 表本身当 outbox，worker 用 `FOR UPDATE SKIP LOCKED` 认领，效果相同（崩溃不丢单、不重复提交），少一个依赖、也不需要额外 schema 权限。要不要换回 pg-boss？
- Supabase Cloud 项目建在 us-east-1（文档写 ap-southeast-1）。团队决定不换；代价是数据库往返约 200 到 250 ms，只影响 Console 与后台，不影响链上收紧。

- 关 5 倍数：proposal 写 1.5（容纳交易利润），比赛版用 1.0（1.5 会让「抢先登记 + 自己充值」的攻击有利可图）。要不要回写 proposal？
- 确认级期间的慢车道：快车道全停；温金库冻结到期后，人员可两人签名 + 排队放行。和 proposal 第 5 节一致，请确认
- **审计 2026-10-07（docs/AUDIT_2026-10-07.md）留下要决定的：**
  - Trap 遇到 NOWNodes「不可用」时照常按 CRE 收据收紧（本次实现）。替代方案是 throw 让触发重试，超过 N 个区块再照常收紧；请团队确认用哪种
  - 被触发过的诱饵在公链上可以由 suspect 收款地址反查出来，下次演示前要轮换；旧 commit 里仍有诱饵 label 与探针交易，历史不能改写
  - Trap 只在诱饵被碰时按交易哈希问 NOWNodes，NOWNodes 的访问日志可能累积出诱饵清单（未确认 NOWNodes 是否记录）；可改为按区块号 eth_getBlockReceipts（回复大小要实测）
  - 合成热钱包都是新地址，诱饵地址有更早的链上历史，查 nonce 与首笔交易时间就能分出来（指纹）
  - Console、user-app 把非 31337 的链都当成 Base Sepolia；shared 没有 Ethereum Sepolia 的 CHAIN_ID 与 CRE 链名
- **verify-edge（2026-10-07 实现）留下的：**
  - 衍生链没有深度上限：链上只知道「父是 suspect」，不知道是第几跳；Trek 只在 3 跳内提议 delay，CRE 不能核实跳数
  - 撒灰只被最小金额挡住：suspect 仍可以给无辜地址转超过下限的钱，让它被标成衍生 suspect（它的提款会 PENDING 42，不会被冻结）
  - 原生币边不支持（receipt 没有金额）；要支持需要 getTransactionByHash 或 trace
  - Trek 的 `trek.py watch` 只适用主网：evidenceHash 用 chainId 1、历史走 Etherscan。分叉链用 fork_source.py；要请 chunlong 确认（handoff 待发）
  - 回复 issue #17（待用户同意后再发）：Q1 原生币目前拒绝；Q2 Trap 的 evidenceHash 就在 ThreatAdded 事件里（= keccak256(abi.encode(chainId, txHash, logIndex))），Trek 从事件读即可；Q3 payload 见 10_interfaces「patrol verify-edge」；Q4 vault 延迟不由 verify-edge 决定，衍生 suspect 由 Cosign 关 4 给 PENDING 42；Q5 演示用 `pnpm demo:trace`

## 赛场上要问 Chainlink mentor

- 比赛期间 CRE 配额（log trigger 每 6 秒 10 个事件、每次执行 15 次 EVM read 等）会不会放宽？放宽了也只调参数（额度桶、批量大小），不改架构；对外说的数字一律用默认配额测
- 超过 log trigger 限流的事件是丢还是排队（S10）
- cron handler 里各节点的 latest 会不会先对齐

## 接口变更记录

- OfficerAction 的 nonce：每份签好的动作（EIP-712 digest）只能用一次，作为防重放；不另设每位人员递增的计数器。签名必须按签名人地址升序传入，同一人签两次只算一人
- `consumeVerdict(txHash, userIdHash, to)` 回传 `(manual, notBefore)`：多带 userIdHash 与 to，Receiver 才能记 seenRecipient
- 人工放行另存 `manualOf[txHash]`，不改写既有裁决（保持 I2「decision 不再改变」）；Cosign 的 APPROVE 优先，否则用人工放行
- `VerdictRecorded(txHash, decision, caseId, requestId, publicReason, sealedReason)`：比文档多三个字段，Ponder 与 Console 不必解析报告 calldata
- 一个 Receiver 对应一个 org（构造时写死 orgId），报告信封的 orgId 必须相同
- 部署顺序的循环依赖用一次性 initialize 解决，共四处，都只有部署者能调一次：Receiver（金库、冷钱包、ThreatRegistry）、ThreatRegistry（reporter 与受保护地址）、OfficerSet（ConfigTimelock）、ConfigTimelock（可管理的目标合约）
- ConfigTimelock 只能调用已登记的目标合约；要新增目标，也得排队走它自己
- ColdVault.raiseDelay 收到不比现值大的值时什么都不做（不 revert），重复的确认级报告才保持幂等
- KeyRegistry：KeyBinding 的 nonce 按 userIdHash 递增；新增 `officerCancel`（CANCEL_QUEUED，一位人员即可）
- RequestBoard：签名格式无效时 signer 记为 0，不 revert（由 Cosign 判 REJECT 31）
- sealedReason 格式：每位人员一个信封 = 临时公钥 33 字节 ‖ nonce 12 字节 ‖ 密文 254 字节 ‖ tag 16 字节；明文 = 2 字节长度 ‖ JSON ‖ 补零，所以长度固定（D15）
- 人员签名经 Console 服务端路由写入：先验证 officer 的 JWT，再 `SET ROLE authenticated` 并带入该 JWT 的 claims，仍由 RLS 判断（migration 20261006000200；console_svc 以 INHERIT FALSE 加入 authenticated）
- reset-demo 新部署的 Receiver 与金库不在 ConfigTimelock 的目标清单里：之后要改它们的配置，得先排队 addTarget
- Trap 的 log trigger 每个最多 5 个诱饵钱包、10 个诱饵地址（config schema 强制）
- Receiver.initialize 改为一个 struct：hot、warm、cold、ThreatRegistry、DecoyCommit、PatrolState
- PLANNED_OP（kind 8）与 RESET_ASSET_CHECKPOINT（kind 9）放在 PatrolState（人员签名的 verifyingContract = PatrolState），不放 Receiver：Receiver 合约大小只剩约 6 KB 余量；PlannedOpRegistered 事件也由 PatrolState 发
- DecoyCommit 的初始根在构造时写入（DECOY_ROOT_A / B，来自 decoy-admin commit），之后改根走 ConfigTimelock；ThreatRegistry 构造时传 DecoyCommit 地址才要求证明（部署 env THREAT_REQUIRE_PROOF），阶段 2 的部署可以不要求
- QuorumLens.cosignView 多一个参数 scoreKey（Cosign 先用 K 算出来），回传 score；patrolView 的每个 org 多回传 hotCheckpoints 与 assets；新增 plannedOps(fromHour, toHour)
- Trap log handler 增加 1 次 NOWNodes `eth_getTransactionReceipt`（HTTPClient，密钥是 secret `NOWNODES_KEY`）。收据里没有同一条触发日志就不写报告。`decideTrap` 的规则没改。读取预算见 10_interfaces.md 第 9 节 trap / log 行
- 盐值 salt_i = HMAC(K, "decoy" ‖ uint32 i)；THREAT 的 proof = abi.encode(ident, salt, path)，ident 对钱包是左补零的地址，对账户是 userIdHash
- 隐藏门槛按代币算：T_e = T_min + HMAC(K, "thr" ‖ uint64 e ‖ token) mod (T_max − T_min)；nonce_e = HMAC(K, "thrnonce" ‖ e ‖ token)
- 分数密文 = nonce 12 字节 ‖ AES-GCM(abi.encode(Λ, tLast, pendingCount))；Λ 以千分之一 nat 存；γ^h 表按 ppm 存（h = 0 到 72，之后归零）
- 47 R7（2026-10-07）：QuorumVault 受保护车道（默认关，setProtectedLane 由 timelock 开）。冻结/确认期间,只有「成熟地址(seenAt)+ 金额 ≤ smallCap + 独立额度 R」放行,每分钟补 R;SWEEP 留 reserve 不扫走;两人联名仍被硬冻挡。跳过信任等级 T3(未做)。D112。审计 2026-10-07：matureAge(address) 按 token，新增 error BadLane（车道开启时 matureAge 为 0 或 reserve 大于 cap、关闭时 reserve 不为 0）
- 47 第 3.7 步（2026-10-06）：KeyRegistry 构造多 `recoveryDelay`；新增 rotateKey（共签、立即）、approveRecovery、registerSecondFactor / finalizeSecondFactor / cancelSecondFactor、secondFactorOf、pendingFactor；requestKeyChange 改等 recoveryDelay；cancelKeyChange 也接受第二因素；KeyAction 4 到 7。见 10_interfaces.md 3.7 节
- 47 第 3.6 步（2026-10-06）：RequestBoard.signerKindOf；Receiver Config 加 passkeyNewDelay（部署后不能改）、事件 PasskeyNewFloor、view seenAt、错误 KeyChanged（consumeVerdict 的 APPROVE 路径检查签名人仍是登记的钥匙）。见 10_interfaces.md 3.6 节
- 47 第 3.5 步（2026-10-06）：services/notifier；migration 20261006000400 加角色 notifier_svc 与表 quorum_index.notify_channels（已推到 Supabase Cloud）；D108。限制：停机期间的事件不补发；每用户投递 URL 目前由 quorum_svc 手动写入，用户自助登记（要签名）留给之后
- 47 第 3.4 步（2026-10-06）：passkey。lib/WebAuthn.sol；KeyRegistry 与 RequestBoard 的 sig 接受 65 字节 ECDSA 或 WebAuthn blob；RequestBoard 新增 view `webauthnSigner`；钥匙 id = keccak(qx, qy) 的地址；exchange-api 新增 `POST /keys/register`（只转发）；packages/shared webauthn.ts。见 10_interfaces.md passkey 节。浏览器端（navigator.credentials）没有在真实浏览器里测过，合约与软件认证器的路径有测试
- 47 第 3.3 步（2026-10-06）：Receiver 新增 `userCancelVerdict(txHash, deadline, sig)` 与 `cancelDigest`，EIP-712 类型 CancelWithdrawal（domain QuorumReceiver v1）；事件 UserCancelled；共享向量 cancelDigest。见 10_interfaces.md 最后一节
- 47 第 3.2 步（2026-10-06）：Receiver 的人员动作搬到 OfficerDesk（每 org 一个），Receiver 只留 desk-only 原语；OfficerAction 的 verifyingContract 对这些动作改为 desk；deployments JSON 每个 org 加 `desk`；**旧的部署文件没有 desk，要重新部署**。见 10_interfaces.md 最后一节
- 47 第二阶段（2026-10-06，合约）：RequestBoard.recipientOf；Receiver Config 加 largeNewDelay、holdMax、largeNewTokens、largeNewMins，setLargeNewMin（timelock）、holdVerdict（一位人员，OfficerAction kind 10）、cancelVerdict（两位人员，kind 11）、heldUntil；QuorumVault Config 加 hourCaps、dayCaps，setWindowCaps（timelock）。细节见 10_interfaces.md 最后一节
- 47 第一阶段（2026-10-06）：Reason 新增 73 R7_LARGE_NEW（sealed）；Cosign config 的 phase5 新增 d2Delay、d3Delay、largeNew {mode, delay, minAmount}；APPROVE 的 expiresAt 改为 (notBefore 或区块时间) + VERDICT_TTL；SprtParams 新增 singleSignalCap
- Patrol 的 5 个 trigger 一律注册（0 ping、1 decoys、2 epoch、3 quota、4 reconcile），用 config 开关，sim-runner 才能固定 trigger index
- ThreatRegistry：`expiresAt` 最多 block.timestamp + MAX_TTL（7 天，THREAT_TTL 72 小时在内）；确认级条目按到期小时分桶计数，`activeConfirmedCount()` 最多读 169 个桶，不再扫全部历史（安全审查 High 2）。当前小时到期的条目会多算到该小时结束（偏向收紧，< 1 小时）
- Trap：金额为 0 的 Transfer 一律不触发（A、B 两种都是；ERC-20 的 transferFrom(x, y, 0) 不需要 allowance，任何人都能伪造这条日志。安全审查 High 1）

## 设计变更（实现偏离 proposal 时记录：D 编号、原因、谁同意）

以下是构建文档相对 proposal_v4 已知的偏离，需要团队确认；确认后回写 proposal：

| D | 偏离 | 原因 | 同意人 |
| --- | --- | --- | --- |
| D14.5 | 关 5 倍数 1.5 → 1.0 | 1.5 让「抢先登记 + 自己充值」可获利 | |
| D13 | 视频 1:55「同样手法直接 L2」→ 单一指纹只到 L1，只说「同一地址转人工」 | 符合 §6 E 的基率论证：单一弱信号不升 L2 | |
| D06 | 诱饵地址触发只限「钱从我们金库付过去」 | 否则陌生人转小钱就能远程冻结交易所 | |
| D55（6.3） | CUSUM 外加单分钟尖峰规则（Shewhart）：x_t > spikeMax 时 S 设为 h + spikeHold；动作不变（只减半补充量） | Bitget 回测 CUSUM 在任何 h 都不报警；尖峰规则 10 倍 p99 在 18:58（USDT）、19:01（ETH）报警，事发前 3.8 天误报 0.53 / 0.27 次每天（analysis/bitget_spike.py） | chunloong 要求；待团队确认 |
| D03、D28 | 诱饵钱包只收不转（生活痕迹只有转入） | 否则诱饵自己的转出会误触发；代价是 nonce 永远为 0，是一个破绽 | |
| D19 | PROD 模式不检查 workflowId，只检查 owner + 编码后的 name + kind 白名单 | workflow 配置一变 ID 就变 | |
| D24 | 额度自动补充在阶段 6（proposal 列为 P0） | 阶段 1 到 5 用构造时的初始额度，演示用 reset-demo 恢复 | |
| D14.6 | 关 6「数据源一致」waived，只做「价格过期」 | NOWNodes 没有 Base Sepolia（2026-10-05 确认）；35_phase5.md 5.4 规定这时记为 waived，不拿不同链的数据比 | |
| D38 | 非 EVM 多链对账不做 | 36 小时范围外；只做 XRP 诱饵（P2） | |
| D20 | Receiver 与 ThreatRegistry 用一次性 initialize 解决循环依赖 | 部署顺序需要；调用后锁死，权限清单标注 | |
| 演示 | 假门槛「50 ETH」缩为 5 qETH，真门槛 1 到 3 qETH | 测试代币数量；视频说明是缩小比例 | |
| D17 | 字节码扫描在最后一个 INVALID 之后、而且剩余长度是 32 字节整数倍时停止 | via-IR 会在代码后面附加 32 字节常量，里面的字节可能刚好是 0xf2 / 0xf4；扫描器有单元测试证明真正的 DELEGATECALL 仍会被抓到 | |
| D58 | CUSUM 状态不每分钟写链：检查点每 10 分钟写一次，中间由金库的分钟桶（outRing）重算 | 省的是存储写入（每天约 150 次，不是 1,440 次），报告数量不变（和 QUOTA_REFILL 同一份）；结果与逐分钟相同（D58 检查） | |
| D10 | Cosign 只有一个 handler，用 LATEST（构建文档早先写过 SAFE + 一个 LATEST 的诱饵快速 handler） | log trigger 限流按 workflow 计；SAFE 每笔多等几分钟；重组由合约的三项检查挡住（42_performance.md 第 2 节） | |
| D55、D58 | CUSUM 基线固定（168 组放 config，离线重算），不用 proposal §6 F 的 EWMA 在线学习 | 检查点只需存 S，重算一定等于逐分钟；「温水煮青蛙」抬不高基线；代价是业务量成长后要定期重算 | |
| D26 | 对账从「逐笔对日志」改为「资产守恒」；「每个 Executed 都有 APPROVE」交给合约与不变量 I1 | 日志读取量随流量增长、上限没文档、可被囤积 APPROVE 拖垮；守恒检查读两个数。新增 vault.fund() 与 ASSET_CHECKPOINT；锚点看到只软收紧，SAFE 看到才确认级（D61、D65） | |
| D29 | 诱饵 EOA、真运维 EOA、真白名单与诱饵收款地址的 label 都由 datasets/src/labels.ts 同一个随机生成器产生；真白名单不再写在 seed.sql；每次新增白名单行都把整张表按随机顺序重写，identity id 看不出诱饵 | 原本 label 与插入顺序写死在仓库，拿到 exchange_a 再对照仓库就能标出诱饵（对齐审查阻断 1）；文件 20_data、32_phase2、36_phase6 已同步 | |
| D29 | BUNDLE 扫描范围加上所有被追踪的文件与整个 git 历史，并比对 label；本机没有诱饵清单时记 not-yet，不再记 pass | 对齐审查阻断 3 | |
| 规则 10 | verify:design：40_verification.md 里没注册的 D 项记 fail；已注册但找不到的本地测试（改名或删掉）记 fail，不再记 not-yet；补注册 D04、D05、D07、D14.6、D14.7、D31、D43、D44、D46、D49、D51、D54 | 对齐审查阻断 2、3，测试结果审查 | |
| D14.7、D42、D05、D22 | 关 7 与分数从「PENDING 转人工」改成「延迟的 APPROVE，时间到自动付款」（D1 / D2 / D3）；共享名单、余额、价格维持 PENDING | 每天约 30 笔人工复核、而且没有期限（Binance 量，公开链上数据）；改成每笔都有到期时间。代价：被延迟的票只能靠冻结金库停下，单笔 HOLD 在 47 第二阶段补。见 docs/47 | |
| D05、D22 | thresholdHug 的 λ 4,605 → 7,560，加单一信号上限（到不了 L3） | 真实数据：正常用户贴门槛的比例 0.004% 到 0.03%，原设定 0.5% 太高（Bad 结果之一）；单一信号上限避免一个信号就进 L3 | |
| D20、D09 | 人员动作从 Receiver 拆到 OfficerDesk | Receiver 21.4 KB，离 24 KB 上限只剩 3.1 KB，第三阶段的合约改动放不下；拆出后 Receiver 约 14 KB。安全语义不变：签名验证与排队在 desk，状态检查在 Receiver，Receiver 只认 initialize 时写死的 desk | |
| D105 | 新增 services/keeper：延迟的放行到期后自动送付款；exchange-api 遇到 NotYetValid、Held、QuotaExceeded、WindowExceeded、Frozen、AlertConfirmed 改成 60 秒后重试（原本 QuotaExceeded 记 manual、其他记 failed，延迟的放行永远不会付款） | 第二阶段后才发现：「时间到自动到账」在完整系统里不成立 | |
| D103、D104 | 新增：一位人员可暂停单笔（会到期、有冷却），两位人员取消；金库每小时、每天出金上限（部署时关闭，经 timelock 开） | 被延迟的提款原本只能靠冻结整个金库才停得下来；拆小额的攻击需要时间窗上限兜底 | |
| D102 | 新增 47 R2：大额付新地址延迟，先以影子模式运行 | Bitget 6 笔盗转全部命中、正常提款约 0.08% 受影响（analysis/risk_tradeoff.py，公开链上数据加假设）；上线前先用影子日志量误伤率 | |
| D62 | 新增：RequestBoard 按 org 的提交额度桶、resubmit、积压检查（proposal 没有） | 不可信后台可以用垃圾请求淹没共用的 Cosign，挤掉诱饵账户的触发 | |
| 演示 | `GET /admin/hot-wallets` 不再返回 privateKey。1 qUSD 探针改走 `POST /admin/hot-wallets/transfer`，私钥只在 exchange-api 里解密 | Round 3.5：避免把故事看成「热钱包私钥全部泄露」。后台签名路径被攻破即可 | 用户要求 |
| D112 | 47 R7 受保护车道：冻结或确认级期间，「成熟地址 + 金额 ≤ smallCap + 独立额度 R（每分钟补）」仍放行；SWEEP 留下 reserve。默认关，经 timelock 开 | 2026-10-06 用户要求：收紧时给正常用户留一条小通道。最坏外流：每个金库、每个 token 为 cap + 每分钟补额 × 冻结分钟数 | 待团队确认；proposal 第 4 节要回写 |
| D112 | 审计 2026-10-07：matureAge 改为按 token；车道开启时 matureAge 必须 > 0、reserve ≤ cap，关闭时 reserve 必须为 0（否则 revert BadLane）；seenAt 在 consumeVerdict 之前读 | 原实现 matureAge 是全局值、会被任一 token 覆盖；matureAge = 0 时从没付过的地址也算成熟；reserve 没有上限，可以削弱 SWEEP | |
| D01、D48 | Trap 第二数据源（NOWNodes）：按 chainId 选端点，链上没有 NOWNodes 时只用 CRE 收据。有端点时，「矛盾」（收据存在，但日志不符或 status 不是 1）仍不动作（D48）；「不可用」（null 收据、HTTP 错误、非 JSON、各节点结果不一致）按 CRE 收据照常收紧 | 审计 H1、H2：原实现在 Base Sepolia 上诱饵永远不冻结；NOWNodes 落后一个区块、宕机或限流都会让收紧失效（违反规则 6） | 待团队确认（见待决定） |
| 演示 | workflows/project.yaml 的 staging-settings 同时保留 Base Sepolia 与 Ethereum Sepolia 的 RPC | create-detect-decoy 把 staging 整个换成 Ethereum Sepolia，sim-runner 在 Base 上无法 simulate（对齐审查阻断） | |
| D29 | 攻击者可见热钱包的余额与 label 改由 secrets/visible-wallets.layout.local.json 产生（labels.ts 同一个生成器），不再写在 datasets 源码里；e2e 只在探针之后读它；STATUS 删掉诱饵 label、名次与探针交易 | 审计 H3：仓库能直接看出哪个是诱饵（规则 2） | |
| D28、6 A | 新增 analysis/decoygen：策略库 + Plackett-Luce、区段 SMOTE + 抖动 + 密度比重抽样、DCR 界、双侧 AUC 门槛与 honeyword、贪心 maximin 放置（HMAC 随机化）、预备池 / 晋升 / 轮换 / 烧毁、每期新盐新根、实时模式（127.0.0.1:8791）。只产生计划，不碰链与示例诱饵 | 旧的 decoy-admin 抽样 AUC 0.706、D28 fail；用户要求按 5 步设计做生成器，并在 UI 里看诱饵生成与消失 | 待团队确认（见待决定） |
| D51、6.4 | 实现 patrol verify-edge（trigger 5，HTTP）：Trek 提议的边由 CRE 逐条读 receipt 核实；除了 docs/36 6.4 的「转账存在、from/to/金额对得上、父条目有效」，另加「父地址本身在锚点是 suspect」与每个代币的最小金额；衍生条目 24 小时，证据与到期由 workflow 自算；原生币边暂不支持 | 防止被攻陷的 Trek 拿任意真实转账配上一个有效父证据去标记无辜地址；防撒灰；docs/36 写 24 小时，Trek 提议 72 小时，以设计文档为准 | 待团队确认 |

## 审查记录（每阶段的独立审查结果）

| 阶段 | 日期 | High | Medium | 处理情况 |
| --- | --- | --- | --- | --- |
| 全部（1 到 6） | 2026-10-05 | 3（安全）+ 3 阻断（对齐）+ 5（测试结果） | 若干 | 报告在 docs/reviews/。v1 已修：0 值转账触发陷阱、ThreatRegistry 计数无上限、诱饵 label 写死、verify 漏注册与「缺了算过」、D42 notBefore 没有合约测试。KeyRegistry 换钥匙劫持（High 3）在 3.7 修好：找回要等 recoveryDelay、第二因素或目前的钥匙可取消、换钥匙要共签；其余见 docs/43_addon_review_fixes.md 与三份报告 |

## 砍掉的 P2 与路线图

- XBlock MulDiGraph 排序测试
- 影子模式（ShadowReceiver）
- 完整攻击者策略库（策略 3、5、6 的蒙特卡洛）
- 非 EVM 多链对账
- 批量请求 + Merkle 裁决（每秒约 60 笔，批量大小待 S9）；小额授权分级（42_performance.md 第 3 节）
- 深层溯源：链下多跳搜索，CRE 的 verify-edge handler 逐条核实后才写衍生 THREAT（36_phase6.md 6.4）
- 数据库分区（pg_partman 或原生分区 + pg_cron）、旧数据转 Parquet 放 S3
- eRPC（阶段 8 可选）；多把提交私钥按 userIdHash 分片

## 赛前要核对的外部事实

| 项目 | 来源 | 核对结果 |
| --- | --- | --- |
| FBI Bybit 地址清单（数量、发布日期） | https://www.ic3.gov/psa/2025/psa250226（I-022625-PSA，2025-02-26） | **51 个**以太坊地址，已导入 `datasets.fbi_bybit_addresses`（2026-10-05） |
| Bitget 热、温钱包清单 | BlockSec：https://blocksec.com/blog/bitget-hack-laundering-fund-tracing（2026-09-30，事件 2026-09-24，损失约 3.875 亿美元） | **BlockSec 没有列钱包地址**；只找到一个被截断的热钱包（Scorechain），不能用。时间线（UTC）已核对：测试转账 18:31，大额流出 18:58，发现并暂停提款 19:05，最后一笔 21:23，关站 21:44 |
| Bybit 攻击者种子地址、恶意 Safe 交易 hash | Verichains 初步报告、Etherscan | 恶意交易 `0x46deef0f52e3a983b67abf4714448a41dd7ffd6d32d32da69d62081c68ad7882`（区块 21895238，2025-02-21 14:13:35 UTC，operation = 1）；Safe `0x1Db92e2EeBC8E0c075a02BeA49a2935BcD2dFCF4`；7 个种子地址。详见 docs/research/public_data_sources.md |
| 交易所热钱包标注 | Etherscan 名称标签 | Binance、Coinbase、OKX、Kraken 共 9 个地址，已导入 `datasets.benign_labels`；标签只说明属于哪家交易所，**不说明是热钱包还是冷钱包** |
| Bitget 头 18 分钟流出约 2.28 亿美元 | **出处是 Arkham**（经 Bitcoin.com News 报道），不是 BlockSec | 引用时要写 Arkham |
| Circle 关于 USDC 冻结的立场 | Circle 原话 | 未核对 |
