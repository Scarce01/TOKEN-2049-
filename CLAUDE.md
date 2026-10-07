# Quorum：给 Claude Code 的项目说明

> 开赛（2026-10-06）后才按这些文档写代码。赛规不允许开赛前写代码、做原型；开赛前只做账号、额度、数据源这类准备（见 docs/00_overview.md 第 6 节）。

## 这个项目是什么

交易所出金的第二道防线。主轴：在交易所里埋诱饵（陷阱）；攻击者一碰，由 Chainlink CRE 节点网络自动收紧出金，交易所后台关不掉。预防层：用户意图核对（七关）、只会转账的金库、额度桶、对账。设计依据是 docs/proposal_v4.md（团队提案，以它为准）。

## 先读什么

1. docs/00_overview.md：架构、仓库结构、环境、阶段计划
2. docs/10_interfaces.md：合约接口、报告格式、事件、EIP-712、ID 规则。改接口前先改这份文件
3. docs/20_data.md：数据来源、Supabase 表、种子数据、秘密怎么放
4. 当前阶段文档：docs/31_phase1.md 到 38_phase8_aws.md
5. docs/39_console_ui.md：Console 的页面与原则（使用者是交易所安全团队的值班人员）
6. docs/40_verification.md：设计要求 D01 到 D65，以及怎么证明实现符合设计
7. docs/41_evaluation.md：数据集、回测、对抗模拟、误报控制、测试金字塔
8. docs/42_performance.md：延迟、吞吐量、链上写入、缓存、数据库负担（每个 workflow 的读取预算与 trigger 限流以这里为准）
9. docs/STATUS.md：每个阶段做完、每个 spike 跑完，都要更新这里

## 不能违反的规则

1. **交易所后台不可信。** 放行、拒绝、收紧的逻辑只能在 CRE workflow 和合约里。apps/exchange-api 和 Supabase 的 exchange_* schema 里不能有任何判断逻辑，也不能有诱饵清单。
2. **诱饵清单只放三个地方：** CRE secrets / workflow 配置（不进 git；明文地址只允许出现在 trap 的 log trigger 配置里，因为日志过滤需要明文；cosign 一律用 tag，patrol 的原生币诱饵放 secret `PATROL_DECOYS`）、本地不进 git 的 `secrets/decoys.local.json`、Supabase 的 `quorum_index.traps`。日志只打 tag 或案件编号。能读 traps 的只有 Quorum 侧服务（sim-runner、decoy-admin 用 `quorum_svc`；trap-sync 用 `trap_sync_svc`；Console 服务端路由用 `console_svc`，只读）和登录后的值班人员。indexer（Ponder，`ponder_svc`）读不到 traps。诱饵相关的读取不经共用的 RPC 代理，代理不记录请求内容。仓库、exchange_* schema、exchange-api、user-app、前端打包内容、anon key 能读到的任何表、日志里，都不能出现「哪个是诱饵」。
3. **金库只听 QuorumReceiver；QuorumReceiver 只听白名单里的 workflow 和两位人员联名。** 没有 owner 后门：forwarder、模式、冷钱包地址部署后不能改；其余配置一律走 ConfigTimelock（两人签名 + 排队）；没有任何「重设额度」「换人员」的直接函数。部署私钥部署完就没有权限。
4. **每个链上动作都要幂等。** 同一个事件可能被模拟或处理多次；VERDICT 只写一次，THREAT 按证据去重（见 10_interfaces.md 3.2）。
5. **workflow 代码必须确定性：**
   - 写上链的时间（issuedAt、expiresAt、notBefore、分数衰减）一律用触发区块的区块头时间（`headerByNumber`）；cron handler 开头取锚点区块 latest − ANCHOR_LAG（5 个区块）的区块头，之后所有读取与时间都用它（不同节点的 latest 可能不一样）。不用 `Date.now()` / `new Date()`；`runtime.now()` 只用于日志
   - 判定逻辑写成纯函数（输入是 `Reads` 对象），handler 只负责读取与写报告，这样才能单元测试
   - 金额、分数一律 bigint 整数，不用浮点
   - 遍历对象先排序 key；不用 `Promise.race` / `Promise.any`
   - 加密与哈希用 `@noble/hashes`、`@noble/curves`、`@noble/ciphers` 或 viem；不能用 `node:crypto`、`fetch`、`process.env`、ethers
   - 所有 EVM read 指定同一个区块号；读取预算见 10_interfaces.md 第 9 节，链上状态尽量用 QuorumLens 一次读完
   - 需要「随机」的地方（ECIES 临时钥匙、nonce）一律由 HMAC(K, …) 派生，不用随机数
   - EVM client 没有 getCode，不要设计依赖它的判断
6. **收紧用 LATEST，放宽用 FINALIZED。** 冻结、清零额度、升等级可以用最新区块的数据；解冻、补额度、降等级必须用 finalized 数据。单笔提款的裁决不算「放宽」：Cosign 只有一个 handler，触发用 LATEST，读取指定事件所在区块（原因见 42_performance.md 第 2 节；安全性来自用户签名，合约写入 APPROVE 时还会再查一次额度）。
7. **上链动作要读状态验证。** `writeReport` 返回 `TX_STATUS_SUCCESS` 只代表交易进了区块；还要看 `receiverContractExecutionStatus`，测试里还要直接读合约状态（例如 `frozenUntil`）确认真的变了。
8. **数字要标来源：** 测试网实测 / 公开链上数据 / 假设值。Console 和视频里显示的每个数字都要能对应到其中一类。
9. **不用 em dash。** 文案、UI 字符串、注释都不用。UI 文案用英文，专业控制台风格，不做游戏化。
10. **测试归设计所有。** 每个阶段结束前跑 `pnpm verify:design --phase N`，相关 D 项必须通过。不能为了通过而改断言；实现必须偏离设计时，先在 STATUS「设计变更」记录并更新文档，再改检查。

## 技术栈

| 部分 | 选型 |
| --- | --- |
| 合约 | Solidity 0.8.24，Foundry，OpenZeppelin v5 |
| CRE workflow | TypeScript，`@chainlink/cre-sdk`，Bun ≥ 1.2.21，`cre` CLI |
| 链 | Base Sepolia 为主（链名 `ethereum-testnet-sepolia-base-1`），Ethereum Sepolia 备用 |
| 链上读写（链下服务） | viem；批量读用 Multicall3 |
| 索引器 | Ponder 0.17.x，写同一个 Postgres 的 `ponder_quorum` schema（见 42_performance.md 第 6 节） |
| 排队 | pg-boss（outbox 模式），连 Supabase 直连或 session 模式 |
| 交易所假后台 | Bun + Hono |
| 前端（用户 App、Console） | Next.js（App Router）+ viem + wagmi + Tailwind；TanStack Query（读链按区块号缓存） |
| 数据 | Supabase（本地 `supabase start`，之后 Supabase Cloud ap-southeast-1） |
| 部署 | 先本地；之后 AWS（见 docs/90_later_phases.md） |
| 包管理 | pnpm workspaces；workflows 目录用 bun |

## 常用命令（脚手架建好后补全）

- `supabase start` / `supabase db reset`：本地数据库与种子
- `pnpm -C contracts test`（内部跑 `forge test`）
- `pnpm deploy:base-sepolia`：部署合约，写 `deployments/base-sepolia.json`
- `cre workflow simulate workflows/<name> --target staging-settings --broadcast`
- `pnpm dev`：启动 exchange-api、indexer（Ponder）、trap-sync、user-app、console

## 工作方式

- **团队协调（5 个人，各用自己的 Claude / GPT，没有固定角色）：** 每次会话开始先运行 `/sync`（等于 `node scripts/team/sync.mjs`）；需要别人改东西、或你改了别人在用的东西，用 `/handoff` 留言，不要直接改他们正在改的文件；不推 main，走 PR。细节见 docs/TEAM_WORKFLOW.md。

- 一次只做当前阶段文档里的任务，按顺序；每个任务做完跑它的验收。
- 遇到文档没写清楚、或和 docs/proposal_v4.md 冲突的地方，停下来在 docs/STATUS.md 的「待决定」里记一条，不要自己发明规则。
- 合约改动必须先写 forge 测试。
- 不要提交 `.env`、`secrets/`、私钥、Supabase service key。
