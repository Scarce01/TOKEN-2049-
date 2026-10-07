# 阶段 8：部署到 AWS（本地全部跑通后）

## 目标

把本地环境搬到 AWS，保留同样的信任边界，部署后重跑全部设计一致性检查。

## 架构

| 组件 | AWS 方案 | 备注 |
| --- | --- | --- |
| exchange-api（A、B 各一个） | ECS Fargate service，ALB 后面 | 镜像放 ECR |
| indexer（Ponder） | ECS Fargate service（1 个副本），私有子网，HTTP 端口不对外 | `ponder_svc`；连 Supabase Cloud 的直连或 session 模式（5432）；断线补抓与重组由 Ponder 处理；schema `ponder_quorum` |
| trap-sync | ECS Fargate service（1 个副本） | `trap_sync_svc`；只给 Console 显示用；直连 RPC，不经 eRPC |
| RPC 代理（可选） | eRPC，ECS Fargate service | 缓存、故障切换、限流；后面接 NOWNodes 与备用服务商（42_performance.md 第 5 节）；关闭请求内容日志；Patrol 与 trap-sync 的诱饵读取不经它 |
| sim-runner（方式 B） | ECS Fargate service | 容器内装 `cre` CLI 与 Bun；用 `CRE_API_KEY` 无浏览器登录；工作目录挂载 workflows 与 config |
| redteam、decoy-admin | 不常驻；需要时用 ECS 一次性任务 | decoy-admin 只由安全负责人启动 |
| user-app、console | Amplify Hosting（Next.js SSR） | console 前端只用 anon key + 人员登录；服务端路由用 `console_svc`（只读）读 ponder_quorum 与 traps，密码放 Secrets Manager，不进前端打包 |
| Supabase | Supabase Cloud（ap-southeast-1，底层在 AWS） | 要求全部在自己 AWS 账号里时，改为 EC2 上 Docker 自托管 |
| 秘密 | AWS Secrets Manager → ECS task 环境变量 | CRE secrets 仍在 CRE（Vault DON 或 sim-runner 的 .env） |
| 日志与告警 | CloudWatch Logs + Alarms | 见下 |
| 基础设施代码 | AWS CDK（TypeScript），infra/ | 一个 stack 一个环境 |

## 步骤

1. `supabase link` 到云端项目；`supabase db push` 推 migrations；在云端重建角色与密码；用 service key 建人员账号并设 role
2. 种子：云端只跑 schema 与 seed.sql；链上种子已经在 Base Sepolia，不重跑；exchange_a / exchange_b 的账本用 `datasets/seed-chain --ledger-only` 从链上重建
3. CDK：VPC、ECR、ECS cluster、各 service、ALB、Secrets Manager、CloudWatch
4. Amplify：连接仓库，设 console、user-app 的环境变量（只放 anon key 和公开地址）
5. 部署后跑 `pnpm verify:design --env aws`（全部阶段）

## 告警

| 告警 | 条件 |
| --- | --- |
| Trap 报告失败 | sim-runner 或 workflow 日志出现 writeReport 失败 |
| indexer 落后或停了 | Ponder 的 `/status` 显示的区块落后链上 > 50 个区块；**拿不到数据也算告警**（CloudWatch 的 missing data 设为 breaching），否则 Ponder 停了反而不响 |
| sim-runner 停摆 | 5 分钟没有 patrol 执行记录 |
| Receiver 收到 ActionFailed | Ponder 写入这个事件时告警 |
| 数据库增长 | 每天新增大小超过 D60 推算值的 2 倍 |

## 安全检查（部署后必须重跑）

- anon key 读 quorum_index、exchange_* 全部失败（D29）
- Amplify 打包产物里找不到诱饵地址、诱饵账户、service key（D29）
- 各 ECS task 只拿到自己需要的秘密；exchange-api 拿不到任何 Quorum 角色的密码；Console 只有 `console_svc`
- Receiver 若仍是 SIM 模式，console 顶部常驻显示「CRE simulation mode」

## 成本与收尾

- Fargate 用最小规格；不用时把 desired count 调成 0
- 比赛结束后：轮换所有密码；撤销 CRE_API_KEY；按需删除 stack
