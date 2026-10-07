# 39 Quorum Console：UI 规格

## 1. 给谁用

交易所安全团队的值班人员。他们的问题只有三个：现在要不要动手？发生了什么、系统已经自动做了什么？我要签什么？

页面按「处理一次事件」的流程排，不按系统组件排。架构图（B1）只用来决定每页的数据从哪来，以及一页 Live System Map。

## 2. 原则

- **当前状态读链，历史读数据库**：警戒、冻结、额度、裁决用 viem 直读合约（D47），经 Multicall3 合成、按区块号缓存（D59）；列表、时间轴经服务端路由读 ponder_quorum 与 quorum_index，前端不直接连这两个 schema
- **后台说的和链上事实分开显示**：凡是来自交易所后台的内容，标「Backend says」
- **每个数字带来源标签**：testnet measured / public on-chain / assumed（D32）
- **专业控制台风格**：信息密度高、深浅两套主题、英文 UI、不做游戏化、没有装饰性动画；动的只有真实事件
- **录屏模式**：一键开启，诱饵地址与诱饵账户打码（D29）
- 顶部常驻状态条：链名、模式（PROD 或 CRE simulation）、两家交易所的警戒等级与冻结倒数、待签名操作数

## 3. 页面

| 页面 | 回答什么 | 主要内容 | 数据 | 阶段 |
| --- | --- | --- | --- | --- |
| Overview | 现在要不要动手 | 警戒等级卡片（含到期倒数）；被触发的诱饵；排队中待签名的操作（人工放行、降级、钥匙登记、配置变更）及倒数；最近 24 小时的案件数 | 链上 + traps + ponder_quorum | 2 |
| Incident（事件详情） | 发生了什么、系统做了什么、我要签什么 | 一个事件一页：证据（哪个诱饵、哪笔交易）；链上已自动执行的动作逐项打勾（读状态，不是读日志）；时间轴；人员操作按钮（延长冻结、放行、否决）；签名进度 2/3 | 链上 + ponder_quorum | 2、3 |
| Live System Map | 让人一眼看懂「后台没参与、链上自动完成」 | B1 简化：诱饵钱包、RequestBoard、Trap、Cosign、Patrol、Receiver、热 / 温 / 冷金库、ThreatRegistry、交易所 B。平时灰色，显示健康状态与最后活动时间；真实事件到达时按顺序点亮对应的边，旁边显示交易链接与秒数 | 服务端路由的 SSE（每个新区块推一次 ponder_quorum 的新事件）+ 链上 | 2（A 交易所）、4（加 B） |
| Cases | 提款裁决列表与三栏对照 | 编号、决定、时间；详情：Backend says / User signed / Chain facts，不一致字段标红；解开的关卡结果，含 SPRT 每个信号的 λ 明细 | 事件 + 链上 + 人员解密 | 3 |
| Traps | 诱饵是否都还在 | 类型、链、余额、上次检查、armed / tripped | quorum_index.traps（trap-sync 更新）+ 链上 | 2 |
| Network | 名单上有谁、谁写的、在别家命中几次 | 名单条目与证据；两家交易所并排状态 | ThreatRegistry + ponder_quorum | 4 |
| Timeline | 按攻击者回放 | 第一个点必须是那笔测试转账，标「marked here」（D43） | traps.tripped_tx + ponder_quorum（服务端路由组合，20_data.md 3.2b） | 4 |
| Controls | 规则有没有被偷改 | 本期门槛承诺与上期揭示（核对通过）；金库 configHash 与 Patrol 的固定值；ConfigTimelock 排队中的变更；Receiver 白名单 | 链上 | 5、6 |
| Evaluation | 这套东西有多好 | 第 6 节指标与 41_evaluation.md 的评估表，每行带来源 | metrics | 6 |

## 4. Live System Map 细节

- 用 React Flow，节点位置写死（不要自动布局，录屏时每次都一样）
- 节点状态：idle（灰）、active（最近 60 秒有事件）、alert（相关的确认级事件）
- 边只在真实事件到达时亮，按事件的区块时间排序依次亮起，每条边标交易 hash 前 6 位与距触发的秒数
- 不画动画粒子、不画蜜蜂；开场蜂巢动画只在视频里，不在产品里
- 点任何节点打开对应页面（例如 Receiver → Controls）

## 5. 组件与技术

- Next.js App Router、Tailwind、shadcn/ui；图表 Recharts；拓扑图 React Flow；读链用 wagmi + TanStack Query（key 带区块号）
- 数字组件 `<Metric value source>`：没有 source 属性就编译失败（D32 的类型检查）
- 签名流程：wagmi 连接人员钱包 → 签 OfficerAction → 存 officer_signatures → 满两人后提交
- 解密：人员在浏览器导入自己的加密私钥，只放内存

## 6. 取代

旧的 UI 设计稿（UI 与 Demo v1、v2，以及 W1 到 W4 草图）按旧主轴设计，以本文件为准。
