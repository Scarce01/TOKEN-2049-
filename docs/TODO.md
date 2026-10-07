# TODO（2026-10-07，main 合入 `integrate/all-features` 之后）

现状：保护层、诱饵检测、跨交易所传播、溯源上链（Trek + CRE verify-edge）、patrol 都已在**模拟链**（Base Sepolia 的本地 anvil fork）
用 CRE CLI `simulate --broadcast` 端到端跑通（见 [AUDIT_2026-10-07.md](AUDIT_2026-10-07.md)）。下面是还缺的东西，按上线顺序排。
勾掉一项时，在 [STATUS.md](STATUS.md) 记证据。

## 1. AWS 部署的前置（38_phase8_aws.md 之前必须先有）

- [ ] **决定 CRE 运行方式**（STATUS「CRE 运行方式」还是空的）：方式 A DON 部署（要 `cre account access`）或方式 B sim-runner + SIM 模式。AWS 设计按方式 B 写（sim-runner 容器 + `CRE_API_KEY`）
- [ ] **公开 Base Sepolia 部署**：`deployments/base-sepolia.json` 还不存在（现在只有 fork、anvil、Ethereum Sepolia）。需要有测试币的 deployer；`SIM_OPERATOR` 要等于 workflows/.env 里 CRE key 的地址；`pnpm deploy:base-sepolia`
- [ ] 公开链上的诱饵：decoy-admin 生成并经 ConfigTimelock 提交 DecoyCommit root（fork 上由 fork-demo/setup.ts 做；公开链要正式流程，只用 secrets/）
- [ ] Base Sepolia 没有 NOWNodes：trap 配置 `nownodesRpcUrl` 为空，只用 CRE 自己的收据（审计 H1/H2 已处理）。要不要另找第二数据源，团队决定
- [x] 8443 的 UI 已搬进仓库：`apps/observatory`（`hexmap.html` 在仓库根目录）。还要决定：Amplify 部署 `apps/observatory` 还是 `apps/console`
- [x] `packages/offchain/scripts/fork-demo/`（setup、bridge、patrol）已提交

## 2. AWS 部署本身（38_phase8_aws.md）

- [ ] 每个服务的 Dockerfile：exchange-api（A、B）、indexer（Ponder）、trap-sync、sim-runner（容器内装 `cre` CLI 与 Bun）、**keeper**、**notifier**（这两个是 47 之后新加的，38 的架构表里还没有，要补进设计）
- [ ] `infra/` AWS CDK（TypeScript）：VPC、ECR、ECS cluster、各 Fargate service、ALB、Secrets Manager、CloudWatch
- [ ] Supabase Cloud：`supabase link`；`supabase db push` 推全部 migrations（`20261006000300_synthetic_withdrawals`、`20261006000400_notifier` 是云端没推过的）；重建角色与密码（含 keeper、notifier 的角色）；建人员账号
- [ ] Secrets Manager → 各 ECS task：exchange-api 拿不到任何 Quorum 角色；Console 服务端只有 `console_svc`；CRE secrets 仍只在 sim-runner 的 .env 或 Vault DON
- [ ] Amplify：console、user-app，只放 anon key 和公开地址
- [ ] CloudWatch 告警（38 的五条）：Trap 报告失败、indexer 落后或停（missing data 算告警）、sim-runner 5 分钟没 patrol、ActionFailed、数据库增长
- [ ] 部署后：`pnpm verify:design --env aws`（CLI 已支持 `--env`）；安全复查（anon key 读不到 quorum_index、exchange_*；Amplify 打包里找不到诱饵与 service key；SIM 模式时 Console 顶部常驻提示）
- [ ] 收尾：Fargate 不用时 desired count 调 0；比赛后轮换所有密码、撤销 `CRE_API_KEY`

## 3. 验收场景（verify:design 34 项 not-yet，单元测试都已通过）

缺的是在链上用 CRE CLI 真跑的场景，结果写进 `reports/scenes/<名字>.json`。**诱饵相关的先不做**。

- [ ] 第 1 组，七关在链上挡得住：`forge_fields`（D14.1）、`s3_forge`（D14.3）、`same_block`（D14.5）、`stale_price`（D14.6）、`l2_new_recipient`（D14.7）；`s6_bybit`（D14.2，要主网 archive RPC）
- [ ] 第 2 组，韧性与信任边界：`s2_wipe`（D01）、`stop_cre`（D27）、`config_drift`（D37）、`threshold_two_epochs`（D21）、`det_patrol`（D30）
- [ ] 第 3 组，跨交易所与溯源：`s4_hop`（D13）、`trace_exclusion`（D31）；`trace_bybit`（D51，要 Etherscan key）
- [ ] 第 4 组，性能与负载：`load_normal`（D41）、`load_normal_rate`（D56）、`load_normal_fingerprint`（D44）、`latency_breakdown`（D57）、`db_volume`（D60）
- [ ] 第 5 组，Console：`console_without_indexer`（D47）、`console_rpc_budget`（D59）
- [ ] 暂缓（诱饵相关）：`s1_trap`（D02）、`s1_trap_status`（D08）、`measure_trap`（D36）、`race`（D45）、`probe_native`（D03）、`forge_decoy`（D04）、`probe_threshold`（D05）、`stranger_transfer`（D06）、`use_api_keys`（D07，P2 未实现）、`s5_timeline`（D43）、`ops_replay`（D49）
- [ ] 不做：`aws_alerts`（D46）等 AWS 部署完再做

## 4. 团队要决定的（细节在 STATUS「待决定」）

- [ ] D28 诱饵可分辨（唯一 fail）：诱饵怎么生成、评估口径
- [ ] NOWNodes 不可用时 Trap 照常收紧（已实现），还是 throw 重试 N 个区块
- [ ] 被触发过的诱饵要轮换；旧 commit 里还有诱饵 label 与探针交易，历史改不了
- [ ] R7：冻结时要不要连车道一起关；车道要不要受 R8 每小时、每天上限约束；proposal 第 4 节回写
- [ ] verify-edge：撒灰只靠最小金额挡；衍生链没有深度上限；原生币边不支持
- [ ] issue #17（Trek 的 5 个问题）：回复草稿在 STATUS，确认后发出

## 5. 技术债与测试缺口

- [ ] R7 车道不在不变量 handler 里
- [ ] `services/decoy-admin`（诱饵生成）没有单元测试
- [ ] 不变量只驱动攻击者调用，合法路径（execute、sweep、topUp、fund）的 ghost 检查还没加
- [ ] notifier 从最新区块开始，宕机期间的事件不会补发（要持久化游标）
- [ ] Console、user-app 把非 31337 的链都当成 Base Sepolia；shared 没有 Ethereum Sepolia 的 CHAIN_ID
- [ ] `trek.py watch` 只适用主网（evidenceHash 写死 chainId 1）；fork 上用 `fork_source.py`，请 chunlong 确认（handoff）
- [ ] `packages/offchain/scripts` 不在 tsc 范围内（`e2e-prevention.ts` 有一个无害的类型断言错误一直没被发现）
- [ ] CRE CLI 1.36.0 → 1.37.0 可升级
- [ ] `apps/observatory` 用 oxfmt、不在 biome 与 pnpm workspace 里：之后统一格式与 lint
- [ ] `archive/` 里的两份旧 UI 草稿：确认没有要回收的东西后可以删
- [ ] `media/2049-tracking-demo.mp4`（27 MB）没进 git：有人看过确认画面里没有真实诱饵地址（规则 2）后再决定提交或另外存放
- [ ] UI 曾出现 React「重复 key」警告（key 是一笔 trap 报告交易 hash 加序号），仓库版载入时没有复现；跑 Attack 动画时留意
