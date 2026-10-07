# Slide 7（数字）与限制页：文案草稿

状态：草稿，2026-10-05。数字全部来自仓库已有结果（README「Results so far」、docs/STATUS.md、docs/research/），每个都标来源类型（CLAUDE.md 规则 8）：

- `[on-chain]` 公开链上数据（BigQuery、Etherscan，有交易 hash）
- `[assumed]` 模拟或假设参数
- `[test]` 自动化测试结果
- `[testnet]` 测试网实测（还没有，部署后补）

slide 上的英文就是台上要放的字；中文是给讲者的备注。不用 em dash。

---

## Slide 7：Numbers

### 标题

> **Measured on public data, not promised.**

### 三栏

**1. Attackers probe first. Decoys catch the probe.**

| 放在 slide 上 | 来源 |
| --- | --- |
| Bitget: test transfer 18:31:11, first large theft 18:58:59 UTC. **27 min 48 s** of reconnaissance | `[on-chain]` tx `0xc19560f5…` 与 `0xa3ae35a0…`，docs/research/bitget_2026-09.md |
| Reconciliation noticed at 19:05, **34 min** after the probe | `[on-chain]` BlockSec 时间线 |
| A random prober hits one of 10 decoys among 200 wallets within 20 tries: **66%** (formula 66.02%, 100,000-run simulation 66.07%) | `[assumed]` D39 |
| Whale-first prober: **99%** within 20 tries | `[assumed]` |

讲者备注：Bitget 那笔测试转账来自真实热钱包，不是诱饵。只能说「**如果**攻击者先碰到诱饵，收紧就在那一刻发生」。「谨慎型攻击者 99%」已撤回（README Bad），**不要引用**。

**2. Large transfers stop at the quota bucket.**

| 放在 slide 上 | 来源 |
| --- | --- |
| **6 of 7** Bitget theft transfers are larger than the fast-lane cap and go to manual review | `[on-chain]` r_max = Bitget 6 每分钟 p99；`[assumed]` C = 5 × r_max |
| An attacker who splits into small transfers is slowed, not stopped: by 19:05 the fast lane allows at most USD 16.9M + 2,435 ETH, versus USD 47.6M + 7,131 ETH actually taken | 同上 |

讲者备注：这一栏要说「slowed」，不能说「stopped」。C 的倍数还是团队待决定事项（STATUS「待决定」），定了以后数字会变。

**3. Tracing gives the shared list a head start.**

| 放在 slide 上 | 来源 |
| --- | --- |
| From the Bybit receiving address alone, one hop reaches **TBD of 51** addresses later published by the FBI | `[on-chain]` analysis/trace_bybit（运行中；初步计数 39 of 51，待评分脚本确认后替换） |
| Our trace has them on day 0; the FBI list came out **5 days** later (2025-02-21 vs 2025-02-26) | `[on-chain]` 区块时间 + FBI PSA I-022625-PSA |

讲者备注：「诱饵在第 0 分钟就有种子」是假设情境（如果 Bybit 当时有诱饵）。召回率只对 FBI 名单算，名单不完整，所以精确率只是下界。

### 页脚（小字）

> Sources: Etherscan / BigQuery public data (tx hashes in repo), FBI PSA I-022625-PSA, BlockSec (2026-09-30). Simulation figures marked "model". Contracts: 93 unit and invariant tests.

### 先不要放上 slide 的数字

| 数字 | 为什么 |
| --- | --- |
| Gate 7 误判 14 / 10,000 | README Bad：SQL 还没提交，换算方法要改，暂时不可复现 |
| 「谨慎型攻击者 99%」 | 已撤回 |
| 「USD 228M in 18 minutes」 | 出自 Arkham，不是 BlockSec；要用就标 Arkham |
| CUSUM 检测时间 | Bitget 回测里 CUSUM 从不报警（见限制页） |
| trap_to_freeze_seconds | 测试网还没跑；部署后实测再补，这会是最有力的一个数 |
| 「330 万美元（28 分钟内快车道最多流出）」 | 那是旧的假设参数（C = 50 万、r_max = 10 万/分钟）。现在用 Bitget 自己的 p99 算出的上界替代 |

---

## Slide 10 的限制部分：Limits we tested

### 标题

> **What this does not do (we measured it).**

| 放在 slide 上 | 来源 | 讲者备注 |
| --- | --- | --- |
| **Volume alarms miss a few huge transfers.** Our CUSUM never fired on the Bitget drain at any threshold. Decoys and the quota bucket carry detection, not statistics | `[on-chain]` | 主动说，这是我们最诚实的一张牌：所以主轴是诱饵，不是异常检测 |
| **The quota bucket slows a careful attacker, it does not stop one.** | `[on-chain]` + `[assumed]` | 数字见 slide 7 第 2 栏 |
| **A careful attacker may avoid decoys.** Our decoys are still partly distinguishable in testing (AUC 0.71, target 0.65); user signatures and the quota bucket are the fallback | `[assumed]` D28 | Ziyu 的 v1 已开始修（随机标签、打乱顺序），修完再更新这个数 |
| **Detect only on non-EVM chains.** Bitget's largest single-chain loss was XRP | `[on-chain]` | |
| **The network needs members.** One exchange gets full protection; the shared list grows with each member | | |
| **Running in CRE simulation** (no DON deploy access yet) | | 拿到部署权限就删掉这一条；视频第一次提到 CRE 时也要说 |
| **CRE secrets are plaintext to node operators today**; Confidential Workflows on the roadmap | | |
| **Only some decoys feed the shared list.** Decoy wallets and decoy accounts write the attacker's address; a decoy recipient address and native-coin decoys tighten locally but have no address to share | `[test]` 代码现状 | 见 docs/evidence/e1_spec_vs_repo.md；问答被问到「碰一下全网都认得你」时要准确 |

### 不说的话（更新）

| 不说 | 改说 |
| --- | --- |
| 「防住所有攻击」 | 「后台说了谎，钱也走不了」 |
| 「Bitget 用了就不会被盗」 | 「同类手法在我们的测试环境里被拦下」 |
| 「首创」 | 「据我们检索，没有看到把诱饵触发直接连到链上自动收紧和跨交易所共享名单的方案」 |
| 「最坏损失可以算出来，所以很小」 | 「最坏损失有上界；对 Bitget 规模，上界拖慢攻击，不是挡住」 |
| 「异常检测会报警」 | 「诱饵负责检测；统计检测只做软动作」 |
| 「碰一下，全网都认得你」（不加限定） | 「碰到诱饵钱包或诱饵账户，全网都认得这个地址」 |

### 问答库要补的三题

| 问题 | 回答要点 |
| --- | --- |
| 你们自己说 CUSUM 抓不到 Bitget，那检测靠什么？ | 靠诱饵，和用户签名。CUSUM 只降低补额度速度，从来不是主力；Bitget 的 7 笔大额里 6 笔超过快车道上限，直接转人工 |
| 额度桶只拖慢，那有什么用？ | Bitget 34 分钟才发现。拖慢就是把「发现之前能走多少钱」从全部变成有上界，配合诱饵把发现时间提前到测试转账那一刻 |
| 攻击者能分辨诱饵吗？ | 测试里还能部分分辨（AUC 0.71），正在改；分辨得出来也只是避开诱饵，签名和额度桶照样挡 |
