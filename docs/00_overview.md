# 00 总览：架构、仓库、环境、阶段

## 1. 架构一句话

交易所后台只能做两件事：提交提款请求、调用金库执行。钱能不能动、要不要收紧，只看 CRE 节点共识后写上链的报告。

## 2. 组件与输入输出

| 组件 | 位置 | 输入 | 输出 |
| --- | --- | --- | --- |
| user-app | apps/user-app | 用户填的代币、地址、金额；用户钱包 | EIP-712 意图签名；KeyRegistry 登记；DepositVault 充值 |
| exchange-api（不可信） | apps/exchange-api | 用户请求 + 签名；exchange_* schema | `RequestBoard.submit`；APPROVE 后 `QuorumVault.execute`；故意保留的 admin 路由（攻击入口） |
| redteam | services/redteam | exchange-api 管理权限；exchange_* schema；诱饵钱包私钥（攻击者偷到的） | 测试转账、伪造提款、删日志 |
| decoy-admin | services/decoy-admin | 安全负责人操作 | 诱饵钱包、诱饵账户、诱饵地址；`secrets/decoys.local.json`；CRE 配置与 secrets |
| trap-sync | services/trap-sync | quorum_index.traps；诱饵的 Transfer 与余额、WithdrawalRequested、Tightened（RPC） | traps 的 status、last_checked、tripped_tx、case_id（只给 Console 显示；收紧不靠它） |
| indexer（Ponder） | services/indexer | 我方合约事件（RPC） | `ponder_quorum` schema：chain_events、cases；自动处理重组与补抓 |
| console | apps/console | 链上状态（viem 直读，按区块缓存）+ 服务端路由（人员登录后读 ponder_quorum 与 quorum_index；新区块经 SSE 推送） | 人员视图；两人签名交易；一人否决 |
| Trap workflow | workflows/trap | 诱饵钱包 / 诱饵地址的 Transfer（log trigger） | 确认级报告 |
| Cosign workflow | workflows/cosign | WithdrawalRequested（log trigger）；链上事实；secrets | VERDICT ± 确认级动作 |
| Patrol workflow | workflows/patrol | cron 60 秒 | 阶段 1：PING；阶段 2：原生币诱饵余额下降 → 确认级；阶段 6：对账、QUOTA_REFILL、CUSUM |
| 合约 | contracts/ | 见 10_interfaces.md | 见 10_interfaces.md |

架构图：docs/diagrams/B1_main_architecture.png、B2_honeypot_architecture.png、B3_prevention_architecture.png。

## 3. 仓库结构

```
quorum/
  CLAUDE.md
  docs/                      本目录；proposal_v4.md 放这里
  contracts/                 Foundry 项目
    src/  test/  script/
  workflows/                 cre init 生成的 CRE 项目
    project.yaml  secrets.yaml  .env（不进 git）
    trap/  cosign/  patrol/  每个有 main.ts、workflow.yaml、config.*.json
  packages/shared/           ABI、报告编解码、EIP-712 类型、ID 工具、seal、常量
  packages/verify/           设计一致性检查（pnpm verify:design）
  verify/                    access_manifest.json 等检查用的清单
  scenes/                    E2E 场景脚本（视频每一段一个）
  analysis/                  离线分析（命中概率与攻击者模拟、诱饵 AUC、H0 与 BigQuery、溯源回测）
  reports/                   design-conformance 报告
  apps/exchange-api/         交易所假后台（攻击目标）
  apps/user-app/             用户 App
  apps/console/              Quorum Console
  services/indexer/          Ponder 索引器，写 ponder_quorum schema（只索引我方合约）
  services/trap-sync/        更新 traps 的状态（Quorum 侧，可读诱饵清单）
  services/redteam/          红队 CLI
  services/decoy-admin/      布诱饵 CLI（安全负责人用）
  services/sim-runner/       没有部署权限时，用 simulate 跑 workflow（见第 5 节）
  services/canary/           诱饵凭证的假托管服务（P2）
  supabase/                  migrations、seed.sql
  deployments/               各链合约地址 JSON
  secrets/                   不进 git：decoys.local.json、officer keys（只在本地）
  infra/                     docker-compose；之后 AWS
```

## 4. 环境

| 环境 | 链 | 数据库 | CRE |
| --- | --- | --- | --- |
| local | Anvil 只跑合约单元测试；集成一律上 Base Sepolia | `supabase start`（Docker） | `cre workflow simulate` |
| testnet | Base Sepolia | 本地 Supabase 或 Supabase Cloud | 有部署权限：部署到 DON；没有：sim-runner |
| aws | Base Sepolia | Supabase Cloud（ap-southeast-1）或 EC2 自托管 | 同上 |

**为什么选 Base Sepolia：** Ethereum Sepolia 在 2026-10-06 13:53 UTC（新加坡时间 21:53，比赛第一天）有 Glamsterdam 升级，CRE 文档提醒前后约 30 分钟链上写入可能失败。Base Sepolia 出块约 2 秒，`filterLogs` 100 个区块 ≈ 200 秒窗口，也够 Patrol 用。阶段 1 要确认 Base Sepolia 上有可用的 ETH/USD Price Feed；没有就改用 Ethereum Sepolia 并避开升级时段。

## 5. CRE 的两种运行方式（阶段 1 决定用哪个）

| | A：部署到 DON | B：sim-runner |
| --- | --- | --- |
| 前提 | `cre account access` 获批，`cre whoami` 显示 Deploy Access | 只要 CRE 账号登录 |
| 报告怎么上链 | KeystoneForwarder，节点共识签名 | MockKeystoneForwarder，单节点模拟 |
| Receiver 能检查什么 | workflow ID、owner、name | metadata 为空，不能检查；改用 SIM 模式守卫（见 10_interfaces.md 3.2） |
| 视频怎么说 | 「DON 共识」 | 必须说明是 CRE 模拟环境 |

sim-runner：对 log trigger 的 workflow 用 `cre workflow simulate --broadcast --listen` 监听实时日志；对 cron 的 workflow 每 60 秒调用一次 `simulate --broadcast --non-interactive`。阶段 1 的 spike S3 先验证 `--listen` 对 log trigger 是否真的可用。

## 6. 开赛前可以做的准备（不写代码）

- [ ] 每人注册 CRE 账号（app.chain.link/cre，需要 2FA），装 `cre` CLI，`cre login`
- [ ] **今天就申请部署权限：`cre account access`**（需要审批，越早越好）
- [ ] 申请 NOWNodes API key；查它是否支持 Base Sepolia、XRP 测试网
- [ ] 建 Supabase Cloud 项目（ap-southeast-1），先不建表
- [ ] AWS 账号与预算提醒
- [ ] Basescan（Etherscan V2）API key，用来验证合约源码
- [ ] Google Cloud 账号，开通 BigQuery（以太坊公开数据集，阶段 6 用）
- [ ] 找好并核对：FBI 的 Bybit 地址公告原文、BlockSec 的 Bitget 钱包清单、要用的交易所热钱包标注来源（只是找资料，不写代码）
- [ ] Base Sepolia、Ethereum Sepolia 测试币（每人一个部署钱包 + 一个红队钱包）
- [ ] 在 data.chain.link 查 Base Sepolia 与 Ethereum Sepolia 的 ETH/USD feed 地址，记进 docs/STATUS.md
- [ ] 把 docs/proposal_v4.md、架构图放进仓库

## 7. 阶段计划（36 小时）

| 阶段 | 小时 | 目标 | 文档 |
| --- | --- | --- | --- |
| 1 地基 | 0 到 5 | 仓库、Supabase、种子、合约 v0、部署、CRE 跑通一份报告、风险 spike、验证框架骨架 | 31_phase1.md |
| 2 陷阱主轴 | 5 到 11 | 诱饵钱包被碰（代币与原生币）→ 一份报告完成收紧；红队脚本；Traps 页 | 32_phase2.md |
| 3 预防层最小版 | 11 到 17 | 用户签名提款全流程；诱饵检查 + 关 1 到 5；Cases 页；两人签名、一人否决 | 33_phase3.md |
| 4 蜂群网络 | 17 到 22 | 交易所 B、名单生效、Network 与 Timeline 页 | 34_phase4.md |
| 5 算法 P1 | 17 到 22（与 4 并行） | Merkle 承诺、隐藏门槛轮换、SPRT 加密分数、关 5 到 7、命中概率、诱饵 AUC | 35_phase5.md |
| 6 Patrol 与评估 | 22 到 25 | 对账、额度补充、温补热、CUSUM、溯源、公开数据评估、Bybit 重放 | 36_phase6.md |
| 7 视频 | 25 到 28 | 视频即测试；第 26 小时录 v1，第 28 小时冻结功能 | 37_phase7_video.md |
| 8 AWS | 本地全部跑通后 | 部署并重跑全部一致性检查 | 38_phase8_aws.md |

横跨各阶段的文档：39_console_ui.md（UI）、40_verification.md（实现符合设计）、41_evaluation.md（设计站得住）。

每个阶段结束：`pnpm verify:design --phase N` 全过 + 一次独立审查（40_verification.md 第 6 节）。

## 8. 最大的风险

| 风险 | 后果 | 对策 |
| --- | --- | --- |
| 拿不到 CRE 部署权限 | 只能模拟，Receiver 不能验 workflow ID | 方式 B + SIM 守卫；视频诚实说明 |
| WASM 里 HMAC / AES 跑不起来 | 诱饵 tag、加密原因做不了 | 验签本来就在 RequestBoard 链上做；tag 改用 keccak256(salt ‖ 标识)（viem 已验证可用）；原因先不加密，Console 标「unsealed (demo)」 |
| `--listen` 不支持 log trigger | sim-runner 收不到事件 | sim-runner 自己用 viem 订阅诱饵相关的 Transfer，再调用 `simulate --evm-tx-hash` |
| 每个 workflow 每 6 秒最多 10 个 log 事件（同一 workflow 的 trigger 共用） | 压测时事件被丢 | Cosign 只留一个 handler；RequestBoard 把两家合计限在每秒 1.5 个；超过限流时丢或排队由 S10 实测，resubmit 兜底（42_performance.md） |
| sim-runner 每次 simulate 10 到 40 秒，SIM 模式只有一把广播私钥 | 方式 B 下吞吐量远低于 CRE 上限 | 广播串行、按优先级排队（Trap > Patrol > Cosign）；方式 B 的 D56 改用实测上限，视频不报吞吐量 |
| 不可信的后台用垃圾请求淹没 Cosign | 诱饵账户的触发被挤掉，另一家交易所也受影响 | RequestBoard 按 org 的链上额度桶；resubmit 与积压检查（10_interfaces.md 3.1） |
| filterLogs、EVM read 回复大小没有文档 | 负载高时读不完 | 对账改用资产守恒，不读日志（36_phase6.md 6.1）；CUSUM 用金库的分钟桶；S9 实测 patrolView 回复大小 |
| 报告上链成功但动作没生效 | 演示穿帮 | 规则 6：每个动作都有读状态的测试 |
| Sepolia 升级 | 写入失败 | 用 Base Sepolia |
