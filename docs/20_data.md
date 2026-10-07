# 20 数据：来源、Supabase、种子、秘密

## 1. 数据从哪来

| 类别 | 数据 | 来源 | 标注 |
| --- | --- | --- | --- |
| 我们自己产生 | 用户签名、公钥、充值、提款请求、链上事件 | user-app、exchange-api、测试网合约 | 测试网实测 |
| 我们自己产生 | 交易所假后台的数据（用户、余额、风控配置、热钱包、白名单、日志） | Supabase exchange_a / exchange_b + 种子脚本 | 合成 |
| 我们自己产生 | 诱饵（钱包、账户、地址、假门槛） | services/decoy-admin | 合成 |
| 我们自己产生 | 攻击行为 | services/redteam | 测试网实测 |
| 外部真实 | ETH/USD 价格 | Chainlink Price Feed（Base Sepolia，地址查 data.chain.link） | 外部 |
| 外部真实 | 多链读取、主网交易重放 | NOWNodes | 公开链上 |
| 外部真实 | 交易所热钱包的历史流出 = 真实用户提款分布 H0（阶段 6） | Google BigQuery 以太坊公开数据集（token_transfers），配合公开的热钱包标注；标注来源要记录 | 公开链上 |
| 外部真实 | Bybit 溯源的标准答案 | FBI 2025-02-26 公告列出的地址（约 51 个，核对原文） | 公开 |
| 外部真实 | Bitget 回测 | BlockSec 分析里的热、温钱包（只用以太坊部分，核对原文） | 公开链上 |
| 外部真实 | 共享名单误伤检查 | Forta 标注数据集、EtherScamDB、知名交易所与合约标签 | 公开（质量参差） |
| 拿不到，只能假设 | 正常用户与攻击者的行为概率（SPRT 的 P(s|H0)、P(s|H1)） | proposal_v4 第 6 节 E 的假设值 | 假设 |
| 拿不到，只能假设 | 真实账户特征分布（flatness AUC） | 合成分布 | 假设 |

规则：Console 和视频里出现的每个数字，都要能在 `quorum_index.metrics.source` 或页面标注里看到它属于哪一类。

## 2. Supabase 布局

本地一个 `supabase start` 实例，分四个 schema；上云时比赛版本可以继续用一个项目，正式版本应该把 exchange 和 quorum 拆成不同项目。

| schema | 属于谁 | 谁能读写 | 用途 |
| --- | --- | --- | --- |
| exchange_a | 交易所 A（不可信） | 角色 `exchange_a_app`；红队拿到的就是这个 | 假交易所后台 |
| exchange_b | 交易所 B（不可信） | 角色 `exchange_b_app` | 第二家交易所（阶段 4） |
| quorum_index | Quorum（防守方） | `quorum_svc`（sim-runner、decoy-admin）读写；`trap_sync_svc` 只能读 traps、改 traps 的状态栏位；`console_svc`（Console 服务端路由）只读 traps、metrics；值班人员经 Supabase Auth 登录后按 RLS 只读，并可写 officer_signatures | 诱饵登记、指标、人员签名收集、模拟结果 |
| quorum_index.notify_channels | Quorum | `notifier_svc` 只读这一张表（读不到 traps）；`quorum_svc` 读写 | 用户通知的投递地址（user_id_hash → URL），47 第 3.5 步；通知内容来自链上事件，不经交易所后台 |
| ponder_quorum | Quorum（Ponder 索引器建立与迁移） | 只有 Ponder（用 `ponder_svc` 连接，它对其他 schema 没有任何权限）写；`console_svc` 只读；anon、authenticated、PUBLIC 一律没有权限 | 链上事件、案件、时间轴（见 42_performance.md 第 6 节） |
| datasets | 团队 | `datasets_rw` | 合成数据、公开链上数据、评估结果 |

**权限要求：**

- `exchange_*_app` 不能读 quorum_index 和 datasets。
- **anon key 对 quorum_index 和 exchange_* 一律没有权限。** anon key 会打包进 Console 前端，谁都拿得到；如果 anon 能读 quorum_index.traps，诱饵清单就公开了。
- 值班人员用 Supabase Auth（email OTP）登录，账号的 `app_metadata.role = 'officer'`（只能由 service key 设置）。RLS 策略只放行这个 claim：traps、metrics 可 select；officer_signatures 可 insert、select。
- Realtime 只开 traps 与 officer_signatures，只对 authenticated 的 officer 生效（Realtime 遵守 RLS）。链上事件不走 Realtime，由 Console 服务端路由每个新区块用 SSE 推送。
- ponder_quorum 的表由 Ponder 自己建立，不加 RLS；所以靠 schema 权限隔离：REVOKE anon、authenticated、PUBLIC 的 USAGE；用 `ALTER DEFAULT PRIVILEGES FOR ROLE ponder_svc` 让以后建的表只给 console_svc SELECT；不加进 PostgREST 的 exposed schemas；不设 Ponder 的 views schema。Console 前端不直接读它，只经服务端路由（先验证 officer 登录）。
- 角色分开的原因：Ponder 与面向网络的 Console 服务端都不该能改 traps；Ponder 甚至不该能读 traps。只有 trap-sync 能改 traps 的状态，只有 decoy-admin（`quorum_svc`）能增删诱饵。
- Ponder 自带的 HTTP 服务不挂 `/sql` 与 GraphQL，只在内网可达（31_phase1.md 1.9）。
- 服务连接：exchange-api、redteam 用 `exchange_a_app`；indexer 用 `ponder_svc`；trap-sync 用 `trap_sync_svc`；Console 服务端路由用 `console_svc`；sim-runner、decoy-admin 用 `quorum_svc`；都用 Postgres 直连串或 session 模式（5432），不用 transaction 模式连接池，不用 service key。
- 验收测试：用 anon key select quorum_index、ponder_quorum 任何一张表都必须失败；用 `exchange_a_app` 读 quorum_index、ponder_quorum 必须失败；非 officer 的登录用户读 traps 必须失败；任何登录用户直接读 ponder_quorum 必须失败。

**Console 的权威数据来自链上**：冻结状态、警戒等级、裁决、额度一律用 viem 直接读合约；ponder_quorum 与 quorum_index 只用来显示历史、时间轴和案件列表。这样红队删 exchange_a 的日志，或者 indexer 出问题，都不会让 Console 显示错误的当前状态。读链按区块号缓存（TanStack Query 的 key 带区块号），同一区块内同样的读取只发一次。

## 3. 表

### 3.1 exchange_a（exchange_b 结构相同）

| 表 | 主要字段 | 说明 |
| --- | --- | --- |
| users | id, user_id, user_id_hash, display_name, kyc_level, created_at, last_active_at | **没有「是否诱饵」字段** |
| balances | user_id, token, available, locked, updated_at | 后台账本 |
| deposits_ledger | id, user_id, token, amount, tx_hash, block_number, created_at | 后台记的充值，对应链上 DepositVault |
| withdrawals | id, user_id, token, to_address, amount, nonce, deadline, request_id, tx_hash, status, case_display, intent jsonb, user_sig, created_at, updated_at | status：created / submitted / approved / rejected / pending / executed / failed / manual |
| risk_config | key, value jsonb | 包含假门槛：`large_withdrawal_threshold = {token: qETH, amount: 5}`（proposal 的「50 ETH」按比例缩小） |
| hot_wallets | label, chain, address, kind（vault / eoa）, private_key_enc, status | 真金库（kind vault，没有私钥）+ 两个真的运维 EOA（`ops-gas-01` 付 gas；另一个用随机 label，小额，用来退款）+ 诱饵 EOA。除 ops-gas 外，真、假 EOA 与白名单的 label 都由 datasets/src/labels.ts 同一个随机生成器产生（前缀池相同、编号随机），仓库里没有任何固定的诱饵 label。三个 EOA 都有加密私钥，字段上看不出差别；加密密钥在 exchange-api 的 env，攻击者拿得到 |
| whitelist_addresses | id, label, address, chain | 混入诱饵地址 |
| api_keys | id, name, key_hash, scopes | 阶段 P2 混入诱饵凭证 |
| audit_log | id, actor, action, payload jsonb, created_at | 红队会删 |

### 3.2 quorum_index

| 表 | 主要字段 | 说明 |
| --- | --- | --- |
| traps | id, org_id, label, kind（wallet_erc20 / wallet_native / address / account / threshold / credential）, chain, ref, status, last_checked, tripped_at, tripped_tx, case_id | **防守方的诱饵登记**，只有 Quorum 角色能读；ref 对账户存 userIdHash。status、last_checked、tripped_*、case_id 由 trap-sync 写（怎么对上各类诱饵见 32_phase2.md 2.9），这样 Console 能把诱饵和 ponder_quorum 的案件接起来 |
| metrics | id, run_id, name, value, unit, source（testnet_measured / public_onchain / assumed）, notes, created_at | 例：trap_to_freeze_seconds |
| officer_signatures | id, target_contract, action_kind, subject, value, nonce, deadline, officer, sig, created_at | Console 收集两人签名后再提交 |


### 3.2b ponder_quorum（Ponder 定义，写在 services/indexer/ponder.schema.ts）

| 表 | 主要字段 | 说明 |
| --- | --- | --- |
| chain_events | chain_id, block_number, block_time, tx_hash, log_index, contract, event, args（json） | 主键 (chain_id, tx_hash, log_index)；重组由 Ponder 回滚 |
| cases | case_id, org_id, kind（withdrawal / trap / patrol）, request_id, tx_hash, decision, public_reason, sealed_reason, first_seen, updated_at | 由事件推导 |

**Ponder 只索引我方合约的事件，不读 traps，也不知道哪个是诱饵。** Timeline（原 v_timeline）由 Console 服务端路由组合：第一个点取 traps.tripped_tx（被碰的那笔测试转账），其后按 case_id 与 suspect 接 ponder_quorum.chain_events。

Ponder 每次 schema 变更会重新索引；比赛期间从部署区块开始，重建约数分钟。

### 3.3 datasets

| 表 | 用途 | 阶段 |
| --- | --- | --- |
| synthetic_accounts | 合成账户特征（注册天数、活跃度、充提频率、KYC、余额） | 1 |
| synthetic_withdrawals | 合成正常提款流（金额、时间） | 3 |
| hot_wallet_outflows | 公开热钱包每分钟流出；带 label_source、address、chain（来自 BigQuery） | 6 |
| h0_withdrawals | 从热钱包流出抽出的单笔提款：金额、时间、收款地址是否首次出现；正常用户模拟器的抽样来源 | 6 |
| fbi_bybit_addresses | FBI 公告地址清单，附原文链接 | 6 |
| benign_labels | 已知交易所、DEX、桥、知名合约的地址与来源（溯源排除清单与误伤检查用） | 6 |
| sim_runs | 对抗模拟与正常用户模拟的参数与结果 | 5、6 |
| eval_runs | 每次评估的参数与结果 | 6 |

## 4. 种子数据

顺序很重要：先上链，再写后台账本，账本里的 tx_hash 才是真的。

| 步骤 | 工具 | 产出 |
| --- | --- | --- |
| 1 生成合成账户 | `datasets/gen-accounts`（Bun 脚本） | 100 个账户的特征（规模可调；命中概率曲线用离线公式算，不依赖账户数）：注册天数、活跃度用对数正态；余额重尾（对数正态）。参数写在脚本顶部并标「假设」。写 datasets.synthetic_accounts |
| 2 生成诱饵账户 | `decoy-admin accounts` | 从余额前 50 名的特征分布里抽样，新生成 10 个诱饵账户；和普通账户混在一起，之后走同一条写入路径 |
| 3 生成钥匙 | `datasets/gen-keys` | 为所有 110 个账户生成开发用钥匙，存 `secrets/dev-users.local.json`（诱饵账户的钥匙由 decoy-admin 另存在 `secrets/decoys.local.json`）。**所有账户都要登记钥匙**：否则后台可以抢先给没登记的账户登记自己的钥匙，诱饵账户也会因为「没有钥匙」被看出来 |
| 4 链上登记与充值 | `datasets/seed-chain` | 先 KeyRegistry 批量 register（此时还没充值，立即生效），再 MockERC20 mint + DepositVault.depositBatch。充值金额 = 该账户的后台余额；诱饵账户也一样有真实充值。DepositVault 的钱转到交易所收款地址 |
| 5 写后台账本 | `datasets/seed-chain` | exchange_a 的 users、balances、deposits_ledger（带第 4 步的真实 tx_hash）；balances 必须等于链上 depositedOf |
| 6 风控配置与白名单 | seed.sql | 假门槛、普通白名单地址 |
| 7 诱饵钱包与地址 | `decoy-admin wallets` | 生成诱饵 EOA：mint qUSD、转少量 ETH；写 exchange_a.hot_wallets（随机 label）、whitelist_addresses（真、假行一起按随机顺序重写，identity id 看不出先后）；写 quorum_index.traps、`secrets/decoys.local.json`、trap workflow 配置 |
| 8 金库注资 | `datasets/seed-chain`（`reset-demo` 也调用） | 一律经 `fund()`（直接 transfer 会让资产守恒的计算失准）：热金库注入 10,000 qUSD 和 3 qETH；温金库注入 20,000 qUSD 和 5 qETH，让「冻结温金库」在 Console 上看得出金额 |

成本：110 个账户的登记和充值用批量函数，Base Sepolia 上 gas 很低；先在 Anvil 上跑一遍确认批量大小。

## 5. 秘密放哪

| 秘密 | 放哪 | 谁能看到 |
| --- | --- | --- |
| 部署私钥、红队私钥 | 各自本地 `.env` | 本人 |
| CRE simulate 用私钥 | workflows/.env 的 `CRE_ETH_PRIVATE_KEY` | Scarce；SIM 模式下它的地址就是 simOperator |
| 共享密钥 K（HMAC） | CRE secret `QUORUM_K` | CRE 节点 |
| 诱饵 tag 清单（账户 + 收款地址） | CRE secret `DECOY_TAGS`（打包 hex，每个 tag 8 字节；单个 secret 上限 2 KB，最多约 128 个） | CRE 节点 |
| 假门槛数值（认指纹用） | CRE secret `DECOY_THRESHOLD` | CRE 节点 |
| NOWNodes key | CRE secret `NOWNODES_KEY`；链下服务的 `.env` | |
| 诱饵钱包、诱饵地址（log trigger 过滤用） | workflows/trap/config.staging.json（**加进 .gitignore**，仓库只放 config.example.json）。日志过滤需要明文，这是唯一放明文诱饵地址的 workflow 配置 | workflow 所有者、CRE 节点 |
| 原生币诱饵地址与归属（Patrol 用） | CRE secret `PATROL_DECOYS` | CRE 节点 |
| Cosign 的诱饵 tag → orgId、(i, proof) | cosign config，以 tag 为键（不进 git） | workflow 所有者、CRE 节点 |
| 诱饵总清单 | `secrets/decoys.local.json`（不进 git）；quorum_index.traps | 安全负责人；`quorum_svc`（sim-runner、decoy-admin）、`trap_sync_svc`、`console_svc`（只读）；登录的值班人员。`ponder_svc` 读不到 |
| 人员加密钥匙（解 sealedReason） | 每位人员自己生成，私钥只在本人电脑；公钥列在 cosign config 的 `officerSealKeys` | 本人 |
| 人员私钥 | 各人员自己的钱包 | 本人 |
| Supabase 各角色密码、service key | 各服务 `.env` | |

CRE 限制：每次执行最多 5 次 getSecret，每个 secret 2 KB；Cosign 只读 QUORUM_K、DECOY_TAGS（账户和地址的 tag 打包在一起）、DECOY_THRESHOLD、NOWNODES_KEY 四个。

## 6. 数字的标注规则

- `testnet_measured`：从链上事件时间戳或脚本计时得出，附 run_id 和交易 hash
- `public_onchain`：附地址、区块范围、标注来源
- `assumed`：附「为什么这样假设」一句话
- 视频字幕和 Console 指标卡片上都显示这三类之一
