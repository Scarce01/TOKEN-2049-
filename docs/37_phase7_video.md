# 阶段 7：视频（第 25 到 28 小时）

## 原则

**视频即测试。** 视频的每一段都对应一个可重复运行的场景脚本；脚本通过（`pnpm verify:design --phase 7`）才录。录的是真实运行，等待时间可以快进，但要在画面上标明。

## 场景与脚本

按 proposal_v4 第 11 节的 12 段：

| 时间 | 画面 | 场景脚本 | 录制前必须通过 |
| --- | --- | --- | --- |
| 0:00 | 蜂巢开场动画（15 秒，简洁六边形，不画卡通蜜蜂） | 无（动画素材） | 无 |
| 0:15 | Bitget 时间线 | 无（图表，数字来自 STATUS 已核对的来源） | 数字已核对 |
| 0:30 | 对账 34 分钟才发现；攻击者删记录 | 无 | 同上 |
| 0:40 | 一句话 → 切到 Console | 无 | 无 |
| 0:50 | 红队在交易所 A：recon、probe | `scenes/s1_trap.sh`：reset-demo → recon → probe | D01、D02、D08 |
| 1:05 | Trap tripped → 收紧 → 区块浏览器 | 同上，接 `redteam status` 与 Console | D08、D19 |
| 1:25 | 删日志，链上不变 | `scenes/s2_wipe.sh` | D01 |
| 1:35 | 伪造提款被拒（三栏对照） | `scenes/s3_forge.sh`：forge → Cases 页 | D14（关 3）、D16 |
| 1:55 | 交易所 B：同地址转人工；两个 Console 并排。字幕只说「同一地址转人工」，不说「同样手法直接 L2」（实现里单一指纹只到 L1，见 STATUS 设计变更） | `scenes/s4_hop.sh` | D13 |
| 2:15 | Timeline 回放：第一笔测试转账就被标记 | `scenes/s5_timeline.sh` | D13 |
| 2:30 | Bybit 重放被拒 | `scenes/s6_bybit.sh` | D14（关 2） |
| 2:40 | 网络图 + 边界一句 + 收尾句 | 无 | 无 |

## 录制要求

- 每段画面角落显示：链名、模式（PROD 或「CRE simulation」）、真实时间戳
- 快进段落显示「sped up ×N」
- 数字卡片显示来源类型（testnet measured / public on-chain / assumed）
- 方式 B 时，字幕第一次提到 CRE 时说明「CRE workflow simulation」
- 不出现诱饵地址的完整值（Console 里诱饵地址在录屏模式下打码）
- 英文字幕，没有 em dash

## 数字从哪来

视频里的评估数字只用 41_evaluation.md 第 7 节的四项：不变量测试、命中概率曲线、Bitget 回测、Bybit 溯源召回率，加上测试网实测的 trap_to_freeze_seconds。每个数字显示来源类型。

## 开场动画

- 工具：HTML Canvas 或 Figma 原型导出，15 秒
- 内容：六边形网格；一个格子是诱饵，被碰到后边缘亮起，相邻格子依次封口，网络中其他蜂巢同时出现同一个标记
- 色板与 Console 一致；动画只用于开场 15 秒和结尾

## 时间点

- 第 25 小时：所有场景脚本跑通
- 第 26 小时：录完整版 v1（即使不完美）
- 第 28 小时：冻结功能；之后只修 bug 和重录
- 提交前：用 40_verification.md 的最终检查清单走一遍

## 设计一致性

D32（每个数字有来源）、D29（录屏不泄露诱饵），以及上表各段列出的 D 项
