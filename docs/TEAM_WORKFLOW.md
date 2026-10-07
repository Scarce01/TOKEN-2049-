# 团队协作流程（5 人，各自用自己的 Claude 或 GPT，没有固定角色）

目的：大家各自 push / pull 不会产生版本落差；改接口的人一定会通知到依赖它的人；每个人的 AI 助手都知道别人在做什么。

## 1. 怎么协调：GitHub 就是中枢

没有额外的服务和聊天机器人。所有人的 agent 都读写同一个地方：

| 东西 | 在哪 | 谁写 | 谁读 |
| --- | --- | --- | --- |
| 团队看板 | 带 `board` 标签的置顶 issue | 中心 coordinator（自动，不用手改） | 所有人和所有 agent |
| 给别人留言 | 带 `handoff` 标签、指派给收件人的 issue | 任何人的 agent（`/handoff`） | 收件人的 agent（`/sync`） |
| 接口事实 | `docs/10_interfaces.md` + `packages/shared` | 改接口的人 | 所有人 |
| 审查结果 | PR 评论 | alignment-reviewer、web3-auditor（自动） | PR 作者 |
| 接口变更的待办 | 看板 issue 的评论 | coordinator agent（自动） | 受影响的人 |

## 2. 每个人每天怎么用

**开始会话：** 在你的 Claude Code 里输入 `/sync`。GPT / Codex 会读 `AGENTS.md`，做同样的事。它根据你的 GitHub 账号和你正在改的文件，告诉你：
- main 上有哪些提交和你改的文件重叠、有没有改接口、你要不要 rebase
- 别人发给你的留言
- 别人哪些打开的 PR 和你改的是同一批文件

**需要别人改东西：** 输入 `/handoff`，告诉你的 agent 要对谁（GitHub 账号，或所有人）说什么。它会开一个指派给对方的 issue，对方下次 `/sync` 就看到。**不要直接改别人正在改的文件。**

**提交：**
1. 不直接推 main：`git fetch && git switch -c <你的名字>/<事情> origin/main`
2. 每 2 到 3 小时 `git fetch && git rebase origin/main`
3. 开 PR；没做完先开草稿。CI 绿了、Code Owners 批准后合并（squash）

## 2.1 改接口的规矩

接口文件见 `.github/team.json` 的 `interfaces`。顺序：
1. 先改 `docs/10_interfaces.md`，在 `docs/STATUS.md`「接口变更记录」写一行
2. 改代码；合约改了就重新生成 ABI：`cd contracts && forge build && cd .. && pnpm abi && pnpm exec biome format --write packages/shared/src/abi.ts`（CI 会检查）
3. 对每个依赖方 `/handoff --interface`
4. 合并后，coordinator agent 会在看板下列出谁要做什么

## 3. 自动化一览

| 名称 | 何时跑 | 做什么 | 会不会挡合并 |
| --- | --- | --- | --- |
| `ci` / checks | 每个 PR、每次合并 | 秘密和诱饵有没有进 git、forge test、lint、ABI 一致性、bun 测试；有 `SUPABASE_DB_URL` 时再跑 verify:design | 会（设为必过） |
| `ci` / slither | 同上 | 合约静态分析 | 不会 |
| `agent-review` | PR 打开或更新；在 PR 里留言 `/review` | alignment-reviewer 检查是否符合设计与接口；web3-auditor 做安全审查 | 不会 |
| `coordinator` | 合并、PR 变动、issue 变动、每 2 小时 | 更新看板；main 改了接口时，coordinator agent 列出谁要改什么；看板还会标出被多个 PR 同时修改的文件 | 不会 |

本地也能跑同样的审查：对 Claude 说「用 alignment-reviewer 和 web3-auditor 审查我和 origin/main 的差异」（定义在 `.claude/agents/`）。

## 4. 需要 owner（Scarce01）设置一次

| 项目 | 做法 | 没设会怎样 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Settings → Secrets and variables → Actions | agent-review 和 coordinator 的 agent 评论跳过；看板和 CI 照常 |
| `SUPABASE_DB_URL` | 同上 | verify:design 跳过（有黄色警告） |
| `DECOY_SCAN_LIST` | 同上，诱饵地址或 tag，逗号分隔 | 不扫描诱饵是否泄漏 |
| main 分支保护 | Settings → Branches：要求 PR、要求 `checks` 通过、要求 Code Owners 批准（私有仓库需要 Pro 或 Team 方案） | 靠大家自觉 |

没有角色分工，所以不用登记账号。每个队员的 `gh` 要登录（`gh auth login`），`/sync` 和 `/handoff` 靠它读写 issue。
