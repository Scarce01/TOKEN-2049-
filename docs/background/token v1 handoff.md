# Mindcount 提案：测量链上 AI agent 的"有效独立心智"

Sep 29, 2026 · @Xu Zi Yu

## 结论

值得做，但必须先改掉原来的核心假设。研究推翻了两件事，保住了一件最关键的事。

**被推翻的**

1. **"按底层模型把 agent 分物种"。** 没有任何公开方法能只从链上交易反推 agent 用哪个模型。能做到 88–95% 准确率的方法（LIDAR）要主动给 agent 出测试题，链上做不到。MIT 的市场模拟还发现，用同一家模型提供商并不能预测行为相关（p≈0.3–0.4），真正驱动相关的是模型能力和共享的信息源。
2. **"agent 羊群已经造成过崩盘"。** 找不到任何经证实的事件。2025 年 10 月 10 日约 190 亿美元清算的复盘，归因于杠杆、做市商撤流动性、自动减仓和 Binance 的 USDe 本地预言机，没有一份提到 AI agent。网上几则"2026 年 AI 闪崩"的故事查无出处，不能引用。

**保住的**

监管者公开承认自己看不见这个风险，而且没有人在真实数据上测量它。BIS 2026 年年报写道，监管对市场参与者使用 AI 的可见性"需要改善，才能捕捉模型驱动的相关敞口、羊群行为和算法合谋"。英国央行正和 BIS 创新中心、德国央行用模拟研究哪些 agent 设计会导致羊群，但那是模拟，不是实时数据。

**改后的定位**

不问"这个 agent 是哪个模型"，只问"这 1,000 个钱包实际上有几个独立的心智"。同步的原因可以是同一模型、同一新闻源、同一框架或同一个运营者，产品不需要知道。链上是唯一能在真实数据上测这件事的市场，因为每一笔动作都公开。

**赚钱顺序：** 交易公司和做市商（拥挤度数据已有付费先例）→ agent 保险和 KYA 公司（累积风险定价）→ 借贷和永续协议（经风险服务商和预言机分发）→ 监管者（慢，走补助和试点）。

## 它解决什么问题

Mindcount 回答一个今天没人能回答的问题：一个市场里的自动化参与者，实际上是多少个独立判断在交易。

**目的：它服务谁**

- **交易者：** 知道谁和你在同一笔交易里、他们会在什么触发条件下一起跑。这就是传统金融的拥挤度（crowding），MSCI 2021 年起把它做成每日数据产品卖给机构。
- **协议：** 在 agent 同步度飙升时提前收紧参数（保证金、单一群体敞口上限），而不是崩了再修。
- **预测市场：** 价格等于概率的前提是参与者独立。Mindcount 给每个市场一个独立性分数，告诉你这个价格背后是 300 个独立判断还是 3 个。
- **保险方：** 给 agent 保单定价最怕的是一个漏洞同时触发成千上万份理赔（累积风险）。

**必要性：为什么是现在**

1. **模型错误高度相关。** ICML 2025 研究 350 多个模型：两个模型都答错时，60% 的情况下错成同一个答案。越强的模型错误越相关，跨厂商也一样。
2. **LLM 很难刻意"不一样"。** 2026 年 4 月的协调博弈实验：没有激励时 LLM 58% 的时候选择一致，人类 14%。奖励分歧时 LLM 仍有 27% 一致，人类只有 3.5%。
3. **共享错误信息时相关性变成风险。** MIT 的 7 模型市场模拟发现，共享错误信息时跟踪误差上升 5–7 倍，而且存在换更强模型也消除不了的相关风险底线。样本小，有审稿人指出混杂变量。
4. **监管者公开说看不见。** BIS、英国央行、FSB 都点了名；美国众议员 Foster、Sherman 等 8 人 2026 年 6 月致信 SEC 主席，专门问 AI 交易 agent 的相关交易决策和羊群行为。我没找到 SEC 的公开回复。
5. **连 agent 有多少都测不准。** "Polymarket 30% 钱包是 agent"这个数字没有公开方法。ERC-8004 注册了 50 多万个 agent，但只有 3–15% 有在线端点，评价者里 59–91% 像是协同女巫。测不准本身就是缺口。

**必须正视的反证**

美联储 2025 年 9 月的 FEDS 论文发现，AI 决策中出现信息瀑布的比例只有 0–9%，人类约 20%，而且 AI 瀑布时倾向逆向。所以羊群不是必然的。这恰好是产品存在的理由：它不假设羊群，它测量羊群。温度计不预设你发烧。

## 查证：哪些说法站得住

12 条关键说法里，5 条证据强、1 条中等，3 条站不住，3 条查无实据。Pitch 里只用"强"和"中"的那几条。

| 说法 | 结论 | 依据 |
| --- | --- | --- |
| LLM 的错误高度相关 | 强 | [Kim et al., ICML 2025](https://arxiv.org/abs/2506.07962)：350+ 模型，同错时 60% 错成同一答案 |
| LLM 比人更难刻意分歧 | 强 | [协调博弈实验, 2026-04](https://arxiv.org/pdf/2604.09502)：奖励分歧时 27% vs 人类 3.5% |
| 能从交易行为分辨机器人和人 | 强（样本小） | [以太坊机器人检测](https://arxiv.org/html/2403.19530v2)：83% 准确率，聚类纯度 82.6%，标注集只有 270 个地址 |
| 监管者需要这种可见性 | 强（非强制） | [BIS 年报 2026](https://www.bis.org/publications/aer-2026/progress-peril)、[Breeden 演讲 2026-06](https://www.bankofengland.co.uk/speech/2026/june/sarah-breeden-panel-at-the-european-central-bank-forum-on-central-banking-2026) |
| 交易机构为拥挤度数据付费 | 强 | [MSCI Crowding Model, 2021](https://ir.msci.com/news-releases/news-release-details/msci-launches-crowding-model-solution-provide-institutional) |
| 越强的模型在市场里越同步 | 中 | [Ross, So, Lo 等, 2026-09](https://arxiv.org/html/2609.04373)：t=3.94，R²=0.475，7 个模型 |
| 用同一家提供商就会同步 | 站不住 | 同一篇论文：p≈0.3–0.4，不显著 |
| AI 必然比人更羊群 | 站不住 | [美联储 FEDS 2025-09](https://www.federalreserve.gov/econres/feds/files/2025090pap.pdf)：AI 瀑布 0–9%，人类约 20% |
| agent 羊群造成过崩盘 | 站不住 | [2025-10-10 复盘](https://www.fticonsulting.com/insights/articles/crypto-crash-october-2025-leverage-met-liquidity)没有 AI 归因 |
| 能从链上交易反推 agent 用的模型 | 未找到方法 | [LIDAR](https://arxiv.org/html/2609.28559v1) 需要主动出题，链上做不到 |
| Polymarket 30% 钱包是 agent | 未验证 | [CoinDesk 2026-03](https://www.coindesk.com/tech/2026/03/15/ai-agents-are-quietly-rewriting-prediction-market-trading) 未给方法 |
| 已有公司在测 agent 同步度 | 未找到 | Hypernative、Solidus、Chaos、Gauntlet、8004scan 都不做（见竞争一节） |

含义：这是一个**领先指标**，测的是还没爆发过的风险。Pitch 不能说"它已经造成损失"，要说"实验室证据和监管者都说它会来，而现在没人能看见它"。

## 产品设计

核心指标叫**有效心智数**（Effective Minds，EM）：如果 1,000 个钱包的行为只相当于 3 个独立决策者，EM = 3。

**怎么算**

1. **定义刺激事件。** 价格跳动、预言机更新、大额清算、新闻。每个事件切一个时间窗。
2. **记录每个钱包的反应。** 有没有动、方向、延迟、规模。跨很多事件就得到一张"钱包 × 事件"的反应矩阵。
3. **算有效独立维度。** 取钱包之间反应的相关矩阵，求特征值 λ，用参与比：

```latex
EM = \frac{\left(\sum_i \lambda_i\right)^2}{\sum_i \lambda_i^2}
```

4. **聚出"群"。** 在反应相关图上做社区发现（如 Louvain）。每个群标注规模、控制的资金、典型触发条件和第一反应。不需要知道背后是哪个模型。

这个式子不是新发明。把特征值归一化成比例，它就是生态学的 Hill 多样性数（q=2，即"有效物种数"）；它也和金融里的[吸收比率](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1633027)（Kritzman 等 2011，用前几个主成分解释的方差衡量系统性风险）是同一族方法。两个成熟领域的交集，评委问"凭什么信你这个指标"时有答案。

**输出**

| 输出 | 给谁 | 形式 | 收费 |
| --- | --- | --- | --- |
| 公开 EM 指数 | 所有人、媒体、研究者、监管 | 网页看板 + 链上预言机，定时更新 | 免费 |
| 群级数据与告警 | 交易公司、做市商、基金 | API + 实时推送：哪个群在集结、同步退出概率 | 订阅 |
| 累积风险数据 | agent 保险、KYA 公司 | 数据授权：多少 agent 会被同一件事同时打中 | 年度授权 |
| 协议风控钩子 | 借贷、永续、预测市场 | 预言机读数 + 参数建议（EM 跌破阈值就提高保证金、限制单一群体敞口） | 经风险服务商分成 |

**范围：** 先做一个市场、一条链。候选是 Solana DEX（数据量大、自动化交易多）或 Polymarket（直接对应"独立性"叙事）。要先过滤已知的 MEV 和套利机器人，否则 EM 只会告诉你套利者很同步，这不是新闻。

## 架构

&#91;embedded content: Mindcount 数据流 · 4 步计算，3 种输出\]

同一个引擎分两条路：私有的群级数据走链下 API 收费，公开的 EM 指数由 Chainlink CRE 签名上链，协议直接读取。

## 谁付钱

最先付钱的应该是交易公司，不是协议，也不是政府。他们为拥挤度数据付费已有先例，决策快，不需要治理投票。但要说实话：目前没有任何潜在买家公开说过需要 agent 同步度数据，需求还停在监管者的嘴上。

| 顺序 | 买家 | 他们买什么 | 付费证据 | 定价假设（未验证） |
| --- | --- | --- | --- | --- |
| 1 | 交易公司、做市商、加密基金 | 群级拥挤度、同步退出告警 | [MSCI](https://ir.msci.com/news-releases/news-release-details/msci-launches-crowding-model-solution-provide-institutional) 和 [S3 Partners](https://www.s3partners.com/articles/find-fix-and-avoid-crowding-and-positioning-risk) 已在卖拥挤度数据 | 每家每月 2,000–10,000 美元 |
| 2 | agent 保险和 KYA 公司 | 累积风险：多少 agent 会被同一件事打中 | 2026 年融资活跃：[AIUC](https://siliconangle.com/2026/09/15/ai-agent-certification-startup-aiuc-raises-40m-to-begin-auditing-frontier-models/) 累计 5,500 万美元，[Baselayer](https://forkast.news/baselayer-raises-35m-to-build-the-know-your-agent-layer-agentic-commerce-needs/) A 轮 3,500 万，[Armilla](https://fintech.global/2026/01/23/armilla-ai-raises-25m-to-expand-ai-liability-coverage/) 2,500 万 | 每年 10–30 万美元数据授权 |
| 3 | 借贷和永续协议 | 预言机读数 + 参数建议 | Aave 风险服务商合同每年 160 万到 350 万美元，2026 年曾报价 500 万；[LlamaRisk](https://governance.aave.com/t/arfc-renew-llamarisk-as-risk-service-provider-epoch-4/24446) 每年 350 万，正在 Chainlink CRE 上为 Aave 建风控 | 经风险服务商分成，不直接卖 DAO |
| 3 | 预测市场 | 每个市场的独立性分数 | Polymarket 2026 年 4 月请 [Chainalysis](https://www.coindesk.com/business/2026/04/30/polymarket-taps-chainalysis-to-bring-wall-street-level-oversight-to-crypto-prediction-markets) 做内幕交易监控：有预算，但位置已被占 | 企业合同，待验证 |
| 4 | 监管者 | 系统性风险监测 | BIS、英国央行说需要，但正在自己做模拟 | 补助 + 试点 |

**可比公司：市场天花板有多高**

- [TRM Labs](https://fortune.com/2026/09/09/trmlabs-valuation/)：2026 年 9 月估值 20 亿美元，今年预计约 1 亿美元 ARR。
- [Chainalysis](https://sacra.com/c/chainalysis/)：第三方估计 2024 年约 2.5 亿美元 ARR，估值从 86 亿跌到约 25 亿。
- [Gauntlet](https://www.theblock.co/post/407723/tarun-chitra-gauntlet-125-million-series-c-funding-sbi-holdings)：2026 年 7 月 1.25 亿美元 C 轮。
- [Chaos Labs](https://unchainedcrypto.com/chaos-labs-exits-aave-risk-management-role-citing-v4-workload-and-funding-gap/)：2026 年 4 月退出 Aave，说 500 万美元不够覆盖成本，自 2022 年起一直亏本。DeFi 风控预算小且有争议。
- [Credora](https://www.coindesk.com/business/2025/09/04/crypto-oracle-firm-redstone-acquires-defi-credit-specialist-credora)：融资 600 万美元，2025 年 9 月被 RedStone 收购，卖"预言机驱动的风险评级"给 Morpho 和 Spark。这是 Mindcount 最接近的先例，也是最现实的退出路径。

**第一年收入示意（全是假设）：** 10 家交易公司 × 每月 3,000 美元 = 36 万；2 份保险数据授权 × 15 万 = 30 万；1 个协议通过风险服务商集成 10–20 万。合计约 76–86 万美元 ARR。这个数字要用 3 家设计伙伴的真实报价来验证。

**要警惕的一点：** agent 平台作为买家很脆弱。Giza 在 2026 年 2 月关停了它的 ARMA 和 Pulse DeFi agent。

## 私有化还是公共化

两者都要，分工很清楚：头条指数免费公开，赚钱靠私有的细颗粒数据和告警。这是 open-core，也是指数公司的老路：指数公开，授权和明细收费。

**为什么公开反而帮助赚钱**

- 公开的 EM 指数被媒体、研究者、监管引用，就成为标准。付费客户会想要标准背后的明细。
- 监管者不会引用一个看不见方法的黑箱。方法公开，他们才敢用。
- 链上预言机本来就是公开的，协议要用就必须公开。

**私有收费的部分：** 群级明细和历史、实时告警、回测数据、定制市场覆盖、保险累积风险模型。群只标行为，不标身份，减少隐私和法律风险。

**政府怎么参与（不当第一收入）**

- **新加坡：** MAS 的 [FSTI 4.0](https://www.globalgovernmentfinance.com/singapore-monetary-authority-fsti-4-funding/) 三年 2.2 亿新元，含"AI Pathfinder"类别；原来独立的 RegTech 类别似乎取消了，申请前要确认资格。MAS 的 AI 风险管理指引（AIRG）还没定稿，而且针对单一机构，不管市场级羊群。这正是空白。
- **马来西亚：** BNM [监管沙盒](https://www.bnm.gov.my/sandbox)和 SC 的[数字创新基金](https://www.sc.com.my/development/digital/digid)可以作试点和补助渠道。没找到马来西亚任何关于 AI 羊群的官方表态。
- **采购周期长。** 监管确实会向初创公司买分析工具，例如 SEC 的 [MIDAS](https://www.sec.gov/securities-topics/market-structure-analytics/midas-market-information-data-analytics-system) 由 Tradeworx 建造，FCA 采购 [OneTick](https://www.onetick.com/fca-selects-onetick-to-power-market-surveillance-system) 的监控平台。但适合第二、三年，不适合第一年。

一句话：公司私有，指数公共，政府是信誉和补助来源，不是现金牛。

## 竞争与护城河

目前没找到任何产品在测市场级的 agent 同步度；最接近的是央行自己做的模拟。

| 玩家 | 做什么 | 不做什么 |
| --- | --- | --- |
| [Hypernative](https://www.hypernative.io/product/onchain-monitoring-automated-response) | 300+ 种风险监控：漏洞、脱锚、预言机、清算 | 不看 agent 行为同步 |
| [Solidus Labs](https://www.soliduslabs.com/) | 市场操纵监控 | 不测羊群 |
| Chaos Labs、Gauntlet、LlamaRisk | 协议参数风控、金库管理 | 没有 agent 集中度产品 |
| Chainalysis、TRM | 合规、反洗钱、调查 | 看资金来源，不看行为相关 |
| [8004scan](https://8004scan.io/) | ERC-8004 agent 注册浏览器 | 没有行为聚类；注册数据大量是女巫 |
| 英国央行 + BIS 创新中心 + 德国央行 | 用模拟研究哪些 agent 设计导致羊群 | 模拟，不是实时真实数据。可能是竞争者，也可能是客户 |

**护城河（按强弱）**

1. **数据累积。** "事件 × 反应"数据集随时间增长，越早开始越难追。没有历史就没法回测。
2. **标准地位。** 公开指数一旦被引用，替换它要付出信誉成本。
3. **分发。** 通过 Chainlink CRE 和风险服务商嵌进协议后，替换成本高。

**最大威胁：** Chainalysis 或 Hypernative 加一个功能。应对是先做深一个垂直（预测市场或 Solana DEX），并争取成为他们的数据源，而不是正面对抗。被收购也是好结局，Credora 就是这样走的。

## TOKEN2049 的 36 小时版本

主攻 Chainlink CRE 赛道，顺带报 NOWNodes 和 Solana；放弃 Cardano。Demo 的工作是证明两件事：EM 在崩盘前会先塔，而且它能在链上被协议读到并用上。

**规则提醒：** 开赛前不能写项目代码或做原型。可以读 CRE 和 NOWNodes 文档、定分工、列好要拉的池子、准备答辩问题。CRE 模拟不需审批，部署到 DON 需要申请权限，账户可以提前开好。

**交付物**

| 模块 | 做什么 | 对应赛道 |
| --- | --- | --- |
| 数据管道 | 用 NOWNodes 拉 Solana 几个高流动性池子过去 7 天的 swap，定义 50–100 个刺激事件，过滤已知 MEV 地址 | NOWNodes、Solana |
| EM 引擎 | 反应矩阵 → EM + 群聚类（Python） | 核心 |
| 模拟实验室 | 50 个 LLM 交易 agent 的小市场，两种条件：共享同一新闻源 vs 各自不同来源 | 因果证明 |
| 预言机 | CRE workflow 定时读引擎输出，把 EM 发布到测试网合约 | Chainlink CRE |
| 协议钩子 | 玩具借贷合约读 EM，跌破阈值自动提高保证金 | Chainlink CRE |
| 公开看板 | 实时 EM 曲线 + 群地图 | 展示 |

**分工（4 人）：** 数据和引擎 1 人；模拟市场 1 人；CRE 和合约 1 人；前端和 pitch 1 人。

**时间线**

1. 0–4 小时：数据管道跑通，事件定义定稿。
2. 4–14 小时：引擎出第一版 EM；模拟市场跑通。
3. 14–24 小时：CRE workflow 和合约；看板。
4. 24–30 小时：真实数据和模拟接起来，调阈值。
5. 30–34 小时：彩排 demo，练答辩。
6. 34–36 小时：缓冲。

**3 分钟 demo 剧本**

1. 开场一句："1,000 个钱包，3 个心智。"
2. 看板：真实 Solana 数据的 EM，指出几个一起动的群。
3. 模拟：左边多样市场，右边共享新闻源市场。注入同一条假新闻。右边 EM 先塔，价格随后崩；左边几乎不动。
4. 预言机：EM 跌破阈值那一刻，玩具协议自动提高保证金，屏幕显示链上交易。
5. 收尾：BIS 原话 + "监管者说他们看不见，我们让它在链上可见。"

**评委一定会问，先备好答案**

- "这个风险发生过吗？" 没有，所以是领先指标；模拟给因果证明，监管原话给需求证明。
- "你怎么知道是 AI agent 不是普通机器人？" 不需要知道。同步就是风险，不管是谁在同步。
- "同步不就是大家对同一个事实的理性反应吗？" 对。所以我们区分事件类型，重点看对假信息或噪声的同步反应。
- "谁付钱？" 交易公司先付，MSCI 已经证明拥挤度数据有人买。

## 风险与止损条件

最大的风险不是技术，是没人付钱。每个风险都配一个明确的止损信号，到了就转向，不硬撑。

| 风险 | 可能性 | 应对 | 止损信号 |
| --- | --- | --- | --- |
| 没人付钱（需求还在监管端） | 中高 | 先用免费试用换 3 家交易公司当设计伙伴 | 6 个月 0 付费 → 转卖保险/KYA 公司或寻求被收购 |
| 真实数据里只找到已知套利机器人 | 中 | 过滤 MEV 和套利地址，换到预测市场 | 3 个市场都找不到新型同步群 → 收窄成预测市场"独立性分数" |
| 同步其实是对同一事实的理性反应 | 高 | 按事件类型分开算，重点看对假信息和噪声的同步 | 假信息事件上 EM 和普通事件没差别 → 指标失效，重新设计 |
| 被 Chainalysis 或 Hypernative 复制 | 中 | 做深一个垂直，争取成为他们的数据源 | 对手发布同类产品 → 谈合作或收购 |
| agent 加噪声隐藏自己 | 低 | 加噪声会损失交易优势，成本自担 | 无 |
| 评委认为风险是虚的 | 高 | 直接承认是领先指标，用模拟和监管原话撑 | 无 |

**赛后 30 天要验证的三件事：**

- [ ] 找 5 家交易公司或做市商聊，问他们愿不愿意为群级拥挤度告警付钱、付多少
- [ ] 用 4 周真实数据回测：EM 下跌是否领先于大波动或清算
- [ ] 确认 FSTI 4.0 AI Pathfinder 和 BNM 沙盒的申请资格

## 来源

**研究证据**

- [Correlated Errors in Large Language Models, Kim et al., ICML 2025](https://arxiv.org/abs/2506.07962)
- [Why Better Models Can Create Riskier Systems, Ross, So, Lo et al., 2026](https://arxiv.org/html/2609.04373)
- [LLM 协调博弈实验, 2026-04](https://arxiv.org/pdf/2604.09502)
- [美联储 FEDS 2025-090](https://www.federalreserve.gov/econres/feds/files/2025090pap.pdf)
- [LIDAR: agent 模型识别, 2026-09](https://arxiv.org/html/2609.28559v1)
- [以太坊机器人检测与聚类](https://arxiv.org/html/2403.19530v2)
- [ERC-8004 注册质量研究](https://arxiv.org/abs/2606.26028)
- [Principal Components as a Measure of Systemic Risk, Kritzman et al.](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1633027)

**事件复盘**

- [FTI Consulting: 2025 年 10 月崩盘](https://www.fticonsulting.com/insights/articles/crypto-crash-october-2025-leverage-met-liquidity)
- [CoinGecko: 10 月 10 日崩盘解析](https://www.coingecko.com/learn/october-10-crypto-crash-explained)

**监管**

- [BIS Annual Economic Report 2026](https://www.bis.org/publications/aer-2026/progress-peril)
- [Sarah Breeden, ECB Sintra 论坛, 2026-06](https://www.bankofengland.co.uk/speech/2026/june/sarah-breeden-panel-at-the-european-central-bank-forum-on-central-banking-2026)
- [FSB: AI 的金融稳定影响, 2024-11](https://www.fsb.org/2024/11/the-financial-stability-implications-of-artificial-intelligence/)
- [Foster、Sherman 致 SEC 信, 2026-06-23](https://foster.house.gov/sites/evo-subsites/foster-evo.house.gov/files/evo-media-document/foster_sherman-request-for-information-re-agentic-trading-6.23.2026.pdf)
- [MAS FSTI 4.0](https://www.globalgovernmentfinance.com/singapore-monetary-authority-fsti-4-funding/)
- [BNM 监管沙盒](https://www.bnm.gov.my/sandbox)

**市场与可比公司**

- [MSCI Crowding Model 发布, 2021](https://ir.msci.com/news-releases/news-release-details/msci-launches-crowding-model-solution-provide-institutional)
- [S3 Partners 拥挤度风险](https://www.s3partners.com/articles/find-fix-and-avoid-crowding-and-positioning-risk)
- [Chaos Labs 退出 Aave](https://unchainedcrypto.com/chaos-labs-exits-aave-risk-management-role-citing-v4-workload-and-funding-gap/)
- [LlamaRisk Aave Epoch 4 提案](https://governance.aave.com/t/arfc-renew-llamarisk-as-risk-service-provider-epoch-4/24446)
- [RedStone 收购 Credora](https://www.coindesk.com/business/2025/09/04/crypto-oracle-firm-redstone-acquires-defi-credit-specialist-credora)
- [TRM Labs 估值](https://fortune.com/2026/09/09/trmlabs-valuation/)
- [Chainalysis（Sacra 估计）](https://sacra.com/c/chainalysis/)
- [Polymarket 聘请 Chainalysis](https://www.coindesk.com/business/2026/04/30/polymarket-taps-chainalysis-to-bring-wall-street-level-oversight-to-crypto-prediction-markets)
- [AIUC A 轮](https://siliconangle.com/2026/09/15/ai-agent-certification-startup-aiuc-raises-40m-to-begin-auditing-frontier-models/)
- [Baselayer A 轮](https://forkast.news/baselayer-raises-35m-to-build-the-know-your-agent-layer-agentic-commerce-needs/)
