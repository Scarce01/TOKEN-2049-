# 48 诱饵生成与轮换（decoygen）

> 代码：`analysis/decoygen/`（Python，numpy + scikit-learn + pycryptodome）。测试：`cd analysis/decoygen && python -m pytest -q`（9 项）。
> 所有参数都是假设值（source = assumed）。生成器只在守方本地跑，输出只进 `secrets/`（不进 git）与只含统计的报告。
> 范围：比赛版只做离线计划与实时演示。计划落到交易所、Trap 配置与 DecoyCommit 是另一个经审查的步骤（第 8 节），这一版不碰链，也不碰现有的示例诱饵。

## 1. 攻击者策略库与选择模型（`model.py`）

攻击者只看得到交易所后台的账户字段（`datasets/src/types.ts` Account）：注册天数、活跃度、充值与提款频率、KYC 等级、余额、是否持有 qETH。

| 策略 | 分数（越高越想挑） |
| --- | --- |
| whale | log(余额) |
| dormant_whale | log(余额) − log(活跃度) |
| eth_holder | log(1 + qETH 美元值) |
| trusted_veteran | log(余额) + log(注册天数) |
| busy_withdrawer | log(余额) + log(提款频率) |
| cautious | log(余额)，新账户（注册天数 < 真实 p10）与几乎不活跃（< 真实 p5）各扣 3（「太好的目标像陷阱」） |
| random | 0 |

后台没有的字段（白名单年龄、提款锁、近期大额充值、API key）对应的策略不建模，报告里列在 `notModeled`。

选择模型：Plackett-Luce，权重 w = exp(β · z)，z 是分数按真实账户标准化，β = 2。
第一次挑中诱饵的概率（闭式）P_first = W_D / (W_R + W_D)。蒙特卡洛用 Gumbel-top-k 10,000 次，算 P_first 与「前 5 次内碰到诱饵」P_hit@5；测试要求闭式与模拟差 < 1.5 个百分点。

## 2. 吸引区段与候选生成

- 吸引区段：每个策略取真实账户分数前 10%（最少 8 个）。所有区段的并集是比较基准。
- 种子取自更宽的一圈（每个策略前 20%）：只从区段内取种子时，抖动把一部分候选推出区段被丢掉、却没有从下面推进来的，留下的候选系统性偏富（余额 +0.2 σ）。
- 候选：种子 + 它的 k = 3 个近邻之一，取中间随机一点（SMOTE），再加高斯抖动，尺度 = 种子到最近真实账户的距离。身份（userId、displayName）另外用 `HMAC(K, "decoy-id" ‖ epoch)` 抽，和特征无关，格式同 gen-accounts.ts。
- 一致性规则（同 makeAccount）：KYC ∈ {1,2,3}；15 ≤ 余额 ≤ 60,000；余额 > 2,000 时 35% 放 qETH，否则没有 qETH；qUSD + qETH 合计等于余额。
- DCR 隐私界：候选到最近真实账户的距离要落在区段成员「到最近其他真实账户距离」的 p5 到 p95 之间（太近 = 抄了一个真人，也让攻击者用近邻距离分出来；太远 = 离群）。
- 密度比重抽样（两轮）：用 out-of-fold 的逻辑回归 + 梯度提升估 p = P(候选 | 特征 + 近邻距离)，按 (1 − p) / p 加权不放回抽，抽样数取有效样本数。这一步让所有可见特征同时向区段成员靠拢，而不是只对一个特征做匹配。

## 3. 对抗验证（D28 的口径）

区段并集的真实账户 vs 候选，特征 = 标准化后的 7 个字段 + 近邻距离（攻击者也算得出来）：

- 逻辑回归与梯度提升，5 折 out-of-fold，AUC 用 1,000 次 bootstrap 取 95% 区间
- **门槛是双侧的**：两个模型的区间都要在 [0.35, 0.65] 内。AUC 明显低于 0.5 也是差异（把分类器反过来就是 > 0.65）；小样本过拟合真实账户时就会出现这种情况
- 各区段 AUC（用合并后的 out-of-fold 分数，区段太小不单独训练）、梯度提升特征重要性
- honeyword 测试：每个诱饵配同区段 4 个真实账户，诱饵分数最高的比例要 ≤ 0.35（随机 = 0.2）
- 门槛不过，这一期不补池、不晋升（fail closed），feed 里记 `gate-fail`

验证的是生成器的输出分布（每期几百个候选），不是最后放上去的几个；放置只决定在区段里坐哪里。

## 4. 放置（贪心 maximin + Stackelberg 随机化）

- 目标：所有策略里最小的 P_first 最大；平手比平均值
- 约束：总余额 ≤ 预算（200,000 美元）；任何区段里诱饵占比 ≤ ρ_max = 15%；门槛已过；cautious 攻击者在策略集里
- 每一步在最好的 3 个候选里均匀随机挑（随机数来自 `HMAC(K, "decoy-gen" ‖ epoch)`）：知道这份代码的攻击者没有 K 也算不出放了哪几个

## 5. 生命周期与分层刷新（`lifecycle.py`，每次调用 = 一期，7 天）

1. 用当期真实账户重新校准（区段、门槛、DCR 界）
2. 被碰过的诱饵（43 F4，burned）立刻下线，永不重用；人员手动撤下的（manual）同样处理
3. 校准后不再合格的（DCR、一致性、区段）下线，记 drift
4. 计划轮换：每月约 20%，按「拿掉后 maximin 掉多少」从小到大；小数部分用 HMAC 掷币，长期平均正好 20%
5. 生成、验证、补满预备池（16 个）
6. 预备池里满 2 期（有了 2 期的生活痕迹）的才能晋升；第一期没有成熟的，直接晋升并标 `preAged: false`
7. 新的承诺根：叶子序号 i = epoch << 16 | n，盐 = `HMAC(K, "decoy" ‖ uint32 i)`，所以每期都是新盐、新根（DecoyCommit.verify 与位置无关，接口不用改）；epoch ≥ 1，所以不会和 decoy-admin 的 i < 65536 撞。填充叶 `HMAC(K, "decoy-filler" ‖ epoch ‖ j)`，叶子数取 max(16, 2 的幂)，隐藏数量
8. 生活痕迹：在线与预备池的账户都排登录（Poisson(活跃度 × 7 / 7)）与入金（Poisson(充值频率 × 7 / 30)，金额 = 余额 × lognormal(ln 0.08, 0.9)），时间按 gen-withdrawals.ts 的小时权重。诱饵只收不出（decoy-admin life 的规则）
9. 本期晋升与下线生效的时间 = 窗口起点 + `HMAC(K, "rotate" ‖ epoch)` mod 7 天，不在期边界，攻击者无法卡点

`commit.py` 与 `packages/shared` 逐字节一致（decoySalt、decoyLeaf、userIdHash、decoyTag、OZ 排序配对 Merkle），测试里的向量是 TypeScript 算出来的。

## 6. 输出与保密

| 文件 | 内容 | 谁能看 |
| --- | --- | --- |
| `secrets/decoygen/<name>/state.json` | 预备池、在线、已下线 tag、用过的 userId | 本地，不进 git |
| `secrets/decoygen/<name>/epoch-<e>.json` | 完整计划：身份、特征、承诺路径、生活痕迹、验证细节 | 本地，不进 git |
| `secrets/decoygen/<name>/feed.json` | 只有 tag、区段名、数量、事件、统计 | 守方 UI（运行时取，不打包） |
| `reports/decoygen/<org>-epoch-<e>.json` | 只有统计：AUC、honeyword、P_first、接受率、轮换比例 | 可以公开；不含 tag，不含数量 |

`<name>` 是 `run.py` 的 org（`a`、`b`）或实时模式的 `<org>-live`。不写 `secrets/decoys.local.json`、`secrets/fork-demo.local.json`、workflow 配置、`contracts/.env`，也不上链。

## 7. 实时模式（`serve.py`，127.0.0.1:8791）

```bash
python analysis/decoygen/serve.py --org a --tick 30 --fresh
```

每 `tick` 秒跑一期（演示时钟：一期 7 天 = 30 秒），把这一期的事件按模拟时间换算到这 30 秒里逐个放出，UI 就能看到诱饵生成（进预备池，离线）、晋升（在线）、轮换下线、被烧掉。

| 路由 | 说明 |
| --- | --- |
| `GET /health` | `{ok, org, epoch}` |
| `GET /decoygen/inventory` | `online[]`（已进承诺根）、`offline.pool[]`（预备中，含 `born`、`matureAt`）、`offline.retired[]`（最近 50 个，`status` = retired 或 burned，`reason` = rotated / drift / manual / burned）、`counts`、`summary`（最近一期：根、叶子数、漏斗、门槛、P_first）、`live`、`stepping`、`nextStepAt`（毫秒） |
| `GET /decoygen/stream` | SSE，`event: decoy`，`data` 的 `kind` = epoch / generate / promote / retire / burn / gate-fail；支持 `Last-Event-ID` |
| `GET /decoygen/feed` | 所有期的 feed |
| `POST /decoygen/step` | 立刻跑下一期 |
| `POST /decoygen/burn` `{"tag"}` | 只限在线的；立刻跑一期把它换掉 |
| `POST /decoygen/retire` `{"tag"}` | 在线或预备池的；立刻跑一期 |
| `POST /decoygen/pause`、`/resume` | 停、开时钟 |

只回 tag、区段名、数量与统计；CORS 只放 8443。实时模式默认用 1,000 个合成账户（同 gen-accounts.ts 的分布），原因见第 9 节。

## 8. 还没做（落地）

计划变成真的诱饵要：decoy-admin 读 `epoch-<e>.json`，把预备池账户写进 exchange_*（同真实账户的形状），晋升时登记 Trap（quorum_index.traps、DECOY_TAGS），新根经 ConfigTimelock 提交 DecoyCommit，生活痕迹由 seeder 执行。这一步会换掉现在示例诱饵所在的根，所以这一版不做，等团队决定（STATUS 待决定）。

## 9. 结果（合成数据，source = assumed）

| 数据 | 区段并集真实行数 | 结果 |
| --- | --- | --- |
| 1,000 个合成账户 × 4 个种子 × 2 次生成 | 约 186 | 8 / 8 过门槛；区间上界最大 0.613，平均 0.571；每期约 280 个候选 |
| 实时模式第 1、2 期（1,000 个） | 186 | 区间 [0.415, 0.583]、[0.430, 0.565]，honeyword 0.195、0.178；3,000 个原始候选留下约 275 个；第 1 期在线 8、预备 8 |
| 演示用的 100 个账户（datasets/out/accounts-a.json） | 19 | 不过：区间 [0.223, 0.540]，过拟合那 19 行；ρ_max 15% 下只放得下 1 个 |

结论：100 个账户撑不起 D28 的口径（区段太小，区间太宽，ρ_max 只容得下 1 个诱饵）。要过 D28，真实账户池要到约 1,000 个。

旧方法（decoy-admin `accounts`：抽头部账户，余额 ±25%、注册天数与活跃度 ±20%）的 D28 结果见 STATUS 待决定。
