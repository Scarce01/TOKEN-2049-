# Quorum Agent：项目交接文档

Oct 3, 2026 · @Xu Zi Yu

## 一句话与当前状态

我们要在 TOKEN2049 Origins（10 月 6 至 8 日）做 **Quorum Agent**：代表公司对外谈生意的 AI agent。它听到的每句话都要核实，自己的底牌不外露，资金只能在负责人授权的范围内、按冷热三层流出。

核心引擎已经逐项对照 Chainlink CRE 的官方文档审计过，确定在 36 小时内做得出来。还没定的是对外怎么包装，以及 demo 用哪个场景。目前还没写任何代码，因为比赛规定开赛前不能写。

| 已决定 | 还没决定 |
| --- | --- |
| 产品是代表公司的 agent，人在回路中审批 | 对外的主题怎么说："不会被骗的 agent"太偏防守，扑克的比喻太花哨 |
| 铁律：可以藏，不能骗 | demo 场景：场外买币（推荐）还是做市商合约 |
| 核心机制：先冻结证据，再公开抽签核实；押金和挑战；冷热三层；授权书由合约执行 | 投哪些赛道，要等主办方回复 |
| 主攻 Chainlink CRE 赛道，NOWNodes 是主要数据来源 |  |
| 台上只讲三个瞬间，理论留给 Q&A |  |

## 比赛背景

比赛是 TOKEN2049 Singapore Origins，10 月 6 至 8 日在 Marina Bay Sands 举行，36 小时，每队 4 人。规定开赛前不能写代码、不能做设计稿或原型，只能讨论。

| 赛道 | 已知信息 | 我们的契合度 |
| --- | --- | --- |
| Chainlink：Best Workflow with CRE | 奖金未公布 | 高，核实、判决、放款全部是 CRE workflow |
| NOWNodes Multichain | 奖金未公布 | 中高，多条链的钱包、池子、RPC 路线都走 NOWNodes |
| Cardano Agentic Commerce | 奖金池 $27.5k，第一名 $15k；x402 支付 | 中。主题很对，但 CRE 不能直接写 Cardano，要另外接 x402 |
| Best Use of Solana | 奖金未公布 | 低，CRE 对 Solana 只支持写入 |

去年的经验：总奖给的是简单、真的能跑、一看就懂的 demo；sponsor 奖给的是深度使用 sponsor 技术的作品。

## 要解决的问题

链上不可逆的动作（清算、铸币、借款、付款），往往只凭一个没有核实的说法就执行了，而且造假成本远低于它撬动的金额。AI agent 开始替公司谈生意、付钱之后，这个问题会更严重。

| 事件 | 日期 | 被相信的说法 | 损失 |
| --- | --- | --- | --- |
| [Bitget](https://theindustryspread.com/bitget-387-5m-breach-spoofed-approvals-not-keys/) | 2026-09-24 | 后台被攻陷，审批流程看到的是伪造的交易数据，私钥并没有被偷 | $387.5M |
| [Moonwell MAMO](https://en.cryptonomist.ch/2026/08/28/moonwell-mamo-exploit/) | 2026-08-27 | 流动性很薄的池子被抬价，拿去当抵押 | $8.7M |
| [SK Hynix / Trade.xyz](https://beincrypto.com/hyperliquid-sk-hynix-perp-oracle-liquidations/) | 2026-07-28 | Nextrade 盘前 1 股成交，-29.99% | 名义清算 $57.4M，实际亏损约 $17.3M |
| [Kelp DAO](https://www.openzeppelin.com/news/lessons-from-kelpdao-hack) | 2026-04-18 | 单一 DVN 依赖的 RPC 被污染，送出伪造的跨链消息 | 约 $292M，其中 $190M 随后在 Aave 被借走 |
| [Aave CAPO](https://coin360.com/news/aave-oracle-glitch-26m-liquidations-wsteth) | 2026-03-11 | 配置错误，wstETH 价格偏差约 2.85% | 34 个账户被错误清算，约 $26.4M |

agent 本身也容易被骗。微软的 [Magentic Marketplace](https://arxiv.org/html/2510.25779v1) 实验中，部分模型在提示注入下把钱全付给了骗子。另一项[测试](https://www.securityweek.com/prompt-injection-attacks-trick-ai-agents-into-making-crypto-payments/)中，26 个模型里有 4 个被网页里藏起来的付款指令骗去付款。

## 产品：Quorum Agent

Quorum Agent 会主动扫描、发现机会，把提案和证据链送给负责人批准；批准后在授权范围内自动谈判，超出授权就停下来回报。签约后，它继续监测对方有没有履约。

**铁律：可以藏，不能骗。** agent 可以选择不说；但只要说出口，事实就必须有证据，承诺就必须有押金。对手也要遵守同一条规则。

| 动词 | 攻 | 守 |
| --- | --- | --- |
| **查** | 主动扫描机会；发现对方说法证据不足就发起挑战，赢走它的押金 | 对方说的每一句事实，都先冻结证据再公开抽签核实 |
| **藏** | 只证明必要的事，例如"金库超过 $2,000 万"，不透露确切数字 | LLM 看不到确切底线；规则引擎检查每个报价；只接受结构化消息；出价节奏随机化 |
| **守** | 押得越多的对手，核实越快，诚实的一方换到快速通道 | 授权书由合约执行；审批人数和资金来源按冷热三层递增；发现攻击就把热钱包的钱撤回 cold |

**demo 场景（待定，推荐第一个）：**

- **场外买币：** 公司的金库 agent 要买一批代币，三个卖方 agent 报价。只有价格一个条款，谁都听得懂。
- **做市商合约：** 项目方 agent 跟三家做市商 agent 谈借币加看涨期权。更加密原生，但要先解释条款。

**台上的三个瞬间：**

1. **查：** 对手 B 是"聪明的骗子"。它拉高自己控制的薄池子、污染一条 RPC 路线；用固定规则检查会被骗，Quorum 抽签读到的是其他池子和路线，判 HOLD、发起挑战、罚没押金。
2. **藏：** 对手 C 在消息里藏提示注入，在解析这一步就被丢掉。
3. **守：** 诚实的对手 A 提出的金额超出授权，负责人的手机收到批准请求；签名后从 warm 层分批付款，cold 层不动。

下面是完整的六个阶段。

&#91;embedded content: 六个阶段 · 两处需要负责人\]

负责人只在第③步和第⑤步出手；签约后发现对方违约，会回到扫描，开始新一轮。

## 核心机制

最关键的只有一个：**先冻结证据，再公开抽签决定查哪些证人。** 攻击者事前不知道会被查哪里，只能收买整个证人池；事后任何人都能重算当时抽了谁。其余机制都围绕它。

1. **冻结：** 动作被提出时记下区块 B₀，所有证人的数据都以 B₀ 为准。
2. **抽签：** 等 B₀ 之后的一个 drand 公开随机轮次（每 3 秒一轮），用它算出种子，按公开的概率分布抽出 k 个证人。越难收买的证人越常被抽到；同一个来源每次最多抽一个。
3. **威慑检查：** 只有攻击者怎么做都不划算时才放行（公式如下）。
4. **判决：** ACT（执行）、STAGE（分批、每批封顶）、HOLD（暂停）。只有单一来源时直接 HOLD；HOLD 是黏性的，冷却期内重试不会重新抽签。

```latex
P_{succ}(m)\cdot V - (1-P_{succ}(m))\cdot S - C(m) < 0 \quad \text{for all } m
```

V 是动作金额，S 是对方的押金，C(m) 是收买 m 个证人的成本，P\_succ(m) 是收买 m 个后抽中多数都是被收买者的机会。没有押金时 S = 0，就是 UMA 提出的"造假成本必须大于获利"；不计收买成本时，简化成 p ≥ V/(V+S)。

DEX 池子的造假成本直接从链上储备算出（只适用于 v2 型全区间池子，来自 Mackinga 等人 2022 年的 TWAP 攻击论文）：

```latex
C_1(\varepsilon) = R_B\left(\sqrt{1+\varepsilon} + \frac{1}{\sqrt{1+\varepsilon}} - 2\right)
```

**其他机制：**

- **押金和挑战：** 每个事实性说法都要押金（至少是相关金额的 5%）。任何人可以押挑战金（S 的 20%）发起挑战，用同样的冻结证据加倍抽签重判；输的一方押金归赢的一方，协议收 5%。缺数据算弃权，不算反对，所以 RPC 故障不会导致诚实的一方被罚。
- **冷热三层：** Hot（小额，agent 自己决定）、Warm（一位负责人签名，每小时流出上限）、Cold（两位负责人签名加时间锁，可以被挑战）。预期损失 = 被骗概率 × 一次损失多少；抽签压低前者，分层压低后者。
- **授权书：** 负责人用 EIP-712 签名，合约拒绝任何超出授权的结算交易。行权价、期限这类链上无法执行的条款，只写进成交内容的 hash。
- **谈判协议：** 只接受结构化 JSON 消息，没有自由文字字段。LLM 只在预设选项中做决定，具体数字由规则引擎决定。
- **证据链：** 每个判决对应一份案卷 JSON，hash 随 CRE 报告写上链。提案里的数字一律来自签名报告，不让 LLM 自己写。

## 技术架构

链上部分是 3 个 CRE workflow 加 5 个合约；谈判在链下进行。CRE 规定每个组织最多 3 个 workflow，刚好用满。

| Workflow | Trigger | 做什么 | 每次执行的资源 |
| --- | --- | --- | --- |
| Scout | cron，1 到 5 分钟 | 扫描自家代币池子的造假成本、核实候选对手、履约监测、处理 pending 动作 | EVM read 3 到 6 次（每条链一次 Multicall3），HTTP 3 到 5 次 |
| Judge | EVM log trigger | 冻结、抽签、威慑检查、判决、挑战、罚没，结果写上链 | drand 2 到 3 次，证人最多 10 个，合计不超过 15 个 HTTP |
| Desk | HTTP trigger | 对外回答"这句话可不可信"，x402 按次收费放在 stretch | 每 30 秒最多触发 1 次，只适合低频 |

**合约（Sepolia 和 Base Sepolia）：** MandateRegistry（授权书与多签）、TieredVault（冷热三层）、ClaimBond（押金与挑战）、QuorumReceiver（接收 CRE 报告、黏性 HOLD）、DealSettlement（检查成交条件后分批放款）；另外在 3 条链上部署测试用的 v2 型池子。

**链下：** 公司 agent（LLM 加规则引擎）、照剧本演的对手 agent、只接受结构化消息的消息服务、存放案卷的证据服务，以及一个用来模拟被污染的 RPC 代理（demo 中会明确标示）。

**外部数据：** NOWNodes 是主要的 RPC 路线（key 放在 URL 里，因为 CRE 的 project.yaml 不支持自定义 header）；另加几个公共 RPC 增加供应商的多样性；drand 作公开随机源。Chainlink VRF v2.5 是正式版路线，但在 Sepolia 上要等几分钟，所以现场演示用 drand。

## 现实性审计

每一条设计都对照过 CRE TS SDK v1.22.0 和官方文档。有 9 处原本的说法做不到，已经改掉或标成"有前提"。

| 原本的说法 | 问题 | 改成 |
| --- | --- | --- |
| 签约后自动追回借出的币 | 币转到对方钱包就收不回来 | 罚没履约押金，停止后续分批放款 |
| 用 CRE 的 secret 或内置随机数当种子 | 节点本身知道或算得出来 | 用 drand 公开轮次，任何人事后都能重算 |
| 门槛随机浮动可以防试探 | 有噪声的二分搜索仍然学得出门槛 | 黏性 HOLD，加上每次试探都要付押金 |
| p ≥ V/(V+S) 适用所有情况 | 只适用于有押金的说法 | 改用完整的威慑检查；没押金时 S = 0 |
| 从链上自动找到做市商 | 链上没有可靠的身份标签 | 从登记处读取（ERC-8004 或自建），并要求签名证明地址所有权 |
| 核实 CEX 余额或 AUM | v1 没有办法核实链下数据 | 这类说法权重为 0，zkTLS 列为 stretch |
| 用 C₁ 公式算所有池子 | 只适用于 v2 型全区间池子 | 只用我们自己部署的 v2 型池子 |
| RPC 路线的造假成本用美元算 | 算不出来 | 改用独立供应商的数量当单位，并明说攻击者最多控制 1 个供应商群组的假设 |
| "DON 签名的证据链" | simulation 时走的是模拟 forwarder | 只有拿到部署权限后才是真的 DON 签名，对外要照实说 |

**做完之后真的能跑：** 测试网上的合约和测试、两个 CRE workflow 发出真实交易、冻结证据后公开抽签、多条 RPC 路线互相核实、结构化谈判，以及负责人签名后由合约执行授权范围。

**只能演示、不能宣称做到的：** 跟真实做市商或卖家的交易、主网资金、没拿到部署权限时的 DON 签名、链下资产核实、Uniswap v3 池子的造假成本，以及引用论文的 Veil 防泄露效果。对外只报告我们自己测出来的数字。

## 讨论过程

idea 前后改过十几版。每一步留下了什么、为什么放弃，按时间顺序列在下面。

| 阶段 | 内容 | 结果与原因 |
| --- | --- | --- |
| 1 | 算力对冲（报名时的 idea） | 放弃：不够强，跟赛道不贴 |
| 2 | Mindcount（agent 同质化风险） | 写过完整 proposal，后来被取代：难以做出看得见的 demo |
| 3 | Quorum：不可逆动作执行前比较证据和金额 | 保留为核心引擎：有真实事故，用得到 CRE |
| 4 | 模拟裁判评审后升级 | 加入来源合并、造假成本对比获利、单笔动作判决、有上限的 HOLD |
| 5 | 把 CRE 和 NOWNodes 用到极致 | 保留多条链、多条 RPC 路线当证人；发现"DON 共识防节点说谎、不防源头说谎" |
| 6 | Bitget 新闻与竞品扫描 | 发现 Chainlink 自己的黑客松有两个类似的获奖项目，必须突出差异 |
| 7 | 视觉化：造假成本地图、平行宇宙回放、自动退款 | 保留平行宇宙回放的思路（同一件事、两个结果） |
| 8 | Veil：防止 agent 的出价行为泄露底价 | 单独做太弱：核心算法 Apple 已经发表，CRE 用得很浅。并入成"藏" |
| 9 | Blind Quorum：随机抽证人 | 保留，是最独特的创新；后来升级成"先冻结再公开抽签" |
| 10 | 冷热钱包分层 | 保留：抽签压低被骗概率，分层压低一次能损失多少，两者相乘 |
| 11 | 理论研究 | 引入 Stackelberg 安全博弈、Becker 威慑模型、结构化消息防火墙；纠正三处错误说法 |
| 12 | 单纯守门太无趣 | 改成攻守对称：证明自己、揭穿对方、不泄底、不被骗 |
| 13 | 代表公司的 agent，人在回路审批 | 保留为最终产品形态 |
| 14 | 包装测试 | "不会被骗的 agent"太偏防守；扑克比喻太花哨。待定 |

反复出现的教训：功能一直在增加，故事一直在变乱。所以从现在起定一条规则：任何新点子都要先回答"它能让'同一个谎言，两个结果'这一刻更震撼吗？"，不能就放进以后再说。

## 竞品与差异

现有的守门方案都用固定门槛或者"暂停/不暂停"两种选择；我们没找到任何人随机选择验证者或 RPC，也没找到人把证据要求和每笔动作的金额挂钩。这是搜不到得出的结论，不能百分之百确定。

| 竞品 | 它做什么 | 跟我们的差别 |
| --- | --- | --- |
| [CRE Risk Router](https://chain.link/hackathon/winners/cre-risk-router)（Chainlink 黑客松获奖） | 8 道固定关卡，判决签名上链 | 固定规则、不跟金额挂钩、不抽签 |
| [SentinelCRE](https://chain.link/hackathon/winners/sentinel-cre)（Chainlink 黑客松获奖） | 合规限额、行为评分、两个 AI 都同意才放行 | 管 agent 的行为，不核实输入的数据是不是真的 |
| [Hypernative Transaction Guard](https://www.hypernative.io/product/transaction-guard) | 签名前模拟交易，按固定美元门槛分流审批 | 中心化、门槛固定 |
| [Chaos Labs Edge](https://chaoslabs.xyz/edge) | 带异常检测的 oracle、自动调风控参数 | 单一提供商；异常检测分不出真崩盘和假价格 |
| [UMA](https://medium.com/uma-project/umas-data-verification-mechanism-3c5342759eb8) 乐观 oracle | 提出说法，有人挑战就由代币持有人投票 | 押金固定、投票可被买通、裁决要几小时到几天 |
| [CCIP 2.0](https://chain.link/blog/introducing-ccip-2-0) 的额外验证者 | 发行方自选额外的验证者，可另收验证费 | 按配置固定、公开；我们可以是未来的一个验证者（只能说设计成可接入） |
| [t54 Labs](https://www.theblock.co/post/391273/ripple-franklin-templeton-ai-agent-trust-startup-t54-labs)（2026 年 2 月种子轮 $5M） | x402 的 agent 风险和身份层 | 用信誉打分，不抽查证人 |

信誉系统不会随金额放大：[研究](https://arxiv.org/html/2606.26028)发现，操纵 ERC-8004 上一个 agent 的信誉，中位成本只要 $0.0027 到 $0.055。

## 裁判视角与 pitch 原则

内容够深，风险在于讲不清楚。照着设计文档上台，我们估计大约 6/10；收敛成一条主线、三个瞬间、一个"聪明的骗子"，有机会到 8.5/10。

| 裁判 | 想看什么 | 我们的回应 |
| --- | --- | --- |
| Chainlink CRE | CRE 用得深、用得对 | 核实、判决、放款全部是 workflow；正式版用 Chainlink VRF |
| NOWNodes | 他们的 RPC 是核心，不是装饰 | 多条链、多条 RPC 路线就是证人池 |
| 投资人背景 | 问题真不真、谁会付钱 | 2026 年的真实损失；谈判和抽查按次收费、押金抽成 |
| 技术型怀疑派 | "不就是几个聊天机器人？" | 差别在协议：押金、核实、授权、冷热分层都在链上执行，LLM 可以替换 |

**pitch 原则：**

- 台上最多三个概念：查、藏、守。
- 只有一个高潮：同一个聪明的谎言，固定检查被骗、Quorum 没被骗，然后公开种子当场核对。
- drand、公式推导、威慑检查、履约监测、理论出处全部留给 Q&A。
- 玩具模型的倍数（如"攻击成本 ×5.3"）不能当成事实讲。
- 不说自己是第一个，不说已经是 CCIP 验证者。

**Q&A 必备的 6 题：**

1. HOLD 会不会拖慢交易、造成坏账？小额走 hot 层不受影响；HOLD 有时限、有上限，超过就转为分批。
2. 为什么不每个证人都问？CRE 每次执行最多 15 个 HTTP 调用，付费数据按次收钱；证据先冻结时，问 5 个的成本可以接近问全部的安全性。
3. 攻击者换个动作重试呢？黏性 HOLD，加上试探要付押金。
4. 攻击者塞一堆假证人进证人池呢？证人池经过筛选，同来源合并权重，抽样按造假成本加权。
5. 只有一个来源时怎么办？不抽签，直接 HOLD（SK Hynix 那天早上就是这种情况）。
6. 是部署的还是 simulation？照实回答。

## 36 小时计划

Must 部分估计 33 到 41 人·小时，团队有效工时约 100 到 110 人·小时，做得完；前提是账号、key、测试币在赛前准备好。中控台另外约 8 小时，整合约 6 小时。

| 优先级 | 内容 | 预估工时 |
| --- | --- | --- |
| Must | 合约（授权书、冷热金库、押金、Receiver、结算）加 Foundry 测试 | 10 到 12 小时 |
| Must | Judge workflow：log trigger、drand、加权抽样、读 B₀、威慑检查、writeReport | 8 到 10 小时 |
| Must | Scout workflow：Multicall3、造假成本、核实候选对手、处理 pending 动作 | 5 到 6 小时 |
| Must | 公司 agent（规则引擎、谈判状态机、根据报告生成提案）加对手 A 和 B | 8 到 10 小时 |
| Must | 证据服务加重算核对 | 2 到 3 小时 |
| Should | 对手 C（提示注入）、回报给负责人、出价随机化加自测泄露 | 5 到 6 小时 |
| Should | 冷热自动补钱和紧急撤离 | 2 到 3 小时 |
| Stretch | 履约监测加罚没、Desk 加 x402、zkTLS、VRF 回放 | 各 3 到 8 小时 |

| 人 | 负责 |
| --- | --- |
| A | Scout、证人池、NOWNodes、造假成本、证据服务 |
| B | Judge、drand 抽签、威慑检查、挑战升级 |
| C | 全部合约和测试 |
| D | 公司 agent、规则引擎、对手 agent、中控台、pitch |

**砍功能规则：**

- 第 18 小时：Judge 的抽签还没通，就先用固定证人跑通整个流程；谈判 agent 不稳定，对手全部改成照剧本演。
- 第 24 小时：Must 必须全部跑通，之后只加 Should 和排练，不开新功能。
- 第 30 小时：冻结代码，录一次完整运行作备份。

## 待决定事项与赛前清单

开赛前要定下三件事：对外主题、demo 场景、投哪些赛道。其余都是不用写代码的行政准备。

**待决定：**

- [ ] 对外主题一句话。已排除"不会被骗的 agent"（太偏防守）和扑克比喻（太花哨）。要求：一句话说得出、有攻有守、外人听 30 秒能复述。
- [ ] demo 场景：场外买币（推荐，只有价格一个条款）还是做市商合约。
- [ ] 赛道：主攻 Chainlink；只有主办方允许投多个赛道、而且 x402 来得及做，才顺便投 Cardano。

**赛前清单（都不用写代码）：**

- [ ] 申请 CRE 账号，跑 `cre account access` 申请部署权限（人工审核，时间未知）。
- [ ] NOWNodes：key 能不能放在 URL 里、有没有 eth-sepolia 和 base-sepolia、测试网保留多少个区块的状态、免费额度多少。
- [ ] drand quicknet 的公开 API 能不能连上。
- [ ] 领 Sepolia 和 Base Sepolia 测试币；准备 LLM API key。
- [ ] 把 CRE TS SDK、ReceiverTemplate、forwarder 地址表、Multicall3 地址存成本地文档，开赛后给写代码的 AI 当参考。
- [ ] 问主办方：能不能用 AI coding 工具、能不能投多个赛道、simulation 算不算获奖资格、各赛道奖金多少、赛前写的文字规划能不能用。
- [ ] 团队口头排练一次；找一个不在团队里的人听 30 秒，看他能不能复述主题。

## 参考资料

- [OpenZeppelin：Kelp rsETH 桥被盗的教训](https://www.openzeppelin.com/news/lessons-from-kelpdao-hack)
- [Blockaid：单一 LayerZero DVN 被攻陷](https://blockaid.io/blog/how-a-single-layerzero-dvn-compromise-drained-292m-from-kelpdao)
- [The Industry Spread：Bitget $387.5M](https://theindustryspread.com/bitget-387-5m-breach-spoofed-approvals-not-keys/)
- [BeInCrypto：SK Hynix 永续合约清算](https://beincrypto.com/hyperliquid-sk-hynix-perp-oracle-liquidations/)
- [Nexus Mutual：SK Hynix 事故报告](https://nexusmutual.io/blog/xyz-skhynix-flash-crash-on-hyperliquid-incident-report)
- [Cryptonomist：Moonwell MAMO](https://en.cryptonomist.ch/2026/08/28/moonwell-mamo-exploit/)
- [Coin360：Aave wstETH 错误清算](https://coin360.com/news/aave-oracle-glitch-26m-liquidations-wsteth)
- [Chainlink CRE 文档](https://docs.chain.link/cre)、[CRE 服务限额](https://docs.chain.link/cre/service-quotas)、[CRE TS SDK](https://github.com/smartcontractkit/cre-sdk-typescript)
- [Chainlink：CCIP 2.0](https://chain.link/blog/introducing-ccip-2-0)
- [Chainlink Convergence 黑客松获奖名单](https://chain.link/blog/convergence-hackathon-winners)
- [UMA：造假成本必须大于获利](https://medium.com/uma-project/umas-data-verification-mechanism-3c5342759eb8)
- [Mackinga 等：TWAP oracle 攻击成本](https://eprint.iacr.org/2022/445.pdf)
- [drand tlock](https://github.com/drand/tlock)、[Chainlink VRF](https://docs.chain.link/vrf)
- [Abdelnabi 等：LLM agent 网络的防火墙](https://arxiv.org/abs/2502.01822)
- [Apple：agent 谈判中的行为隐私泄露](https://arxiv.org/html/2607.06815)
- [微软 Magentic Marketplace](https://arxiv.org/html/2510.25779v1)
- [Karp & Kleinberg：有噪声的二分搜索](https://www.cs.cornell.edu/~rdk/papers/karpr2.pdf)
- [Pita 等：洛杉矶机场 ARMOR 随机巡逻系统](https://www.ifaamas.org/Proceedings/aamas08/proceedings/pdf/industrial_application_track/AAMAS08_IndTrack_33.pdf)
- [ERC-8004 实证研究](https://arxiv.org/html/2606.26028)
