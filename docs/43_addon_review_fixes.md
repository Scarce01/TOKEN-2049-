# 43 追加计划：外部审查 9 条的处理方案

> 仅供团队内部讨论；开赛后再正式实现。这份文件只写方案，还没有改进其他文档。团队确认后，按第 3 节的顺序逐条落实，每条都要更新对应文档、加检查、在 STATUS「设计变更」记一笔。

**团队定下的原则（2026-10-05）：不牺牲诚实用户。** 任何防护的代价只能落在攻击者或被攻陷的后台身上。会影响正常用户的做法，要么换掉，要么只出现在比赛版里，并写明正式版怎么消掉它。落实时把这条加进 CLAUDE.md 的规则。

## 1. 审核结论

对照的是目前的构建文档（10_interfaces、31 到 42、STATUS）与 proposal_v4。

| # | 审查意见 | 结论 | 现状 | 严重度 |
| --- | --- | --- | --- | --- |
| 1 | CRE 发 APPROVE 就能付到任意地址 | **部分成立** | 签名人已在链上恢复，写 APPROVE 时合约核对「签名人 = 登记钥匙」。但「用户签的收款地址、金额」和「请求里的收款地址、金额」是否一致，只有 Cosign 在查；txHash 也是后台算好送进来的 | High |
| 2 | fail-slow 的说法自相矛盾 | **成立（文字错）** | proposal §10 写「快车道慢慢耗尽」。实际上每笔都要 APPROVE，CRE 停了只有 15 分钟内已批准的还能执行，新请求全部转人工。D27 的检查内容是对的，名称和 proposal 的说法不对 | Medium |
| 3 | 首次登记钥匙立即生效 | **部分成立** | 有充值记录的账户已经要排队；关 5 倍数 1.0 让抢先登记没有利润。但正式上线那天，现有用户在 DepositVault 都没有记录，全部算「首次」 | Medium（比赛版）、High（正式版） |
| 4 | 诱饵能被任何人远程触发 | **大部分已修，还有一个洞** | 链上 Transfer 这条已修：诱饵钱包只看转出（D03、D28）；诱饵收款地址只在「钱从我们的金库付过去」时触发（D06）。**没修的是 Cosign 这条：** 任何请求只要收款地址是诱饵地址就上确认级（原因 43），包括真用户签名有效的请求。诱饵地址一旦曝光（被触发那次的 RequestBoard 事件就公开了它），任何一个交易所用户发一笔正常提款就能冻结交易所 | Medium |
| 5 | 加密让节点无法共识 | **已修** | 分数的 nonce、ECIES 的临时钥匙都由 HMAC(K, …) 派生；D23、D30 逐字节比对 | 无 |
| 6 | 关 5 误伤法币用户、公开充值记录 | **成立** | 关 5 = 已批准 + 本笔 ≤ 链上充值，硬性挂起。法币买币的用户链上充值是 0；DepositVault 按 userIdHash 公开了每个账户的累计充值 | High（正式版）；比赛版是已知简化 |
| 7 | 指纹含地址 | **已修，但带出误报问题** | fingerprintHash 不含地址。但正因为不含地址，它是 (链, 代币, 金额区间, 动作类型)；试探的金额区间又是小额，一次触发后 72 小时内，所有落在这个区间的正常小额提款都会命中。指纹的 λ = 2303 正好等于 L1 门槛，单独命中就让正常用户进 L1（延迟放行、上限减半） | Medium |
| 8 | 两位人员签名会重演 Bybit | **成立** | OfficerAction 的 subject 是 hash：人工放行签 txHash、冷钱包排队签 keccak(token, to, amount)、配置变更签 keccak(target, selector, args)。硬件钱包上只看得到一串 hash，就是 Bybit 那种盲签 | High |
| 9 | 非 EVM 链只能检测、不能拦截 | **成立，已核对** | BlockSec：XRP 是 Bitget 损失最大的单一链。我们的 XRP 诱饵是 P2，而且只能发现、收紧 EVM 这边 | Medium（pitch 风险） |

审查意见 4、5、7 会被提出来，主因是旧的 B2、B3 架构图还是修之前的版本，要重画（第 2 节 F9）。复查时另外发现 4、7 各有一个没修干净的地方（上表），一并在 F4、F7 处理。

## 2. 逐条方案

### F1：CRE 单独付不出钱（意见 1）

**目标：** 热、温金库的每一笔对外付款，代币、收款地址、金额、金库、nonce 都必须来自一份有效的用户签名，而且在用户签的期限内。CRE 的 APPROVE 是必要条件，不是充分条件。

**比赛版改法：**

1. **txHash 一律由 RequestBoard 用意图的字段算**（第 1 节公式：chainId、vault、requestId、userIdHash、token、to、amount、nonce、deadline 都取自意图），Request 里拿掉后台给的 txHash 字段。所有 kind 都一样，不只 kind 0
2. kind 0：意图与请求的字段必须相同，否则 revert `IntentMismatch`
3. kind 1（Safe 交易，只用来演示 Bybit 式攻击被拦）：txHashOf 记为 0；Receiver 遇到 txHashOf = 0 的 VERDICT 一律忽略。否则「用户真签了意图 X，请求却写另一个 to」这种 kind 1 请求，在 CRE 被攻破时就能被付款
4. **期限：** 金库 execute 要求 block.timestamp ≤ 意图的 deadline；Receiver 写 APPROVE 时 expiresAt 取 min(deadline, 区块时间 + VERDICT_TTL)，报告给的值更大就截断
5. **人工放行也要有用户签名：** 人工放行同样检查 signerOf(requestId) == keyOf(userIdHash) 与 deadline（做法见 F8）
6. **签名人在 submit 就核对，但签错的请求不拒绝，而是分流（两条车道）：**
   - submit 读 KeyRegistry.keyOf(userIdHash)，和恢复出的签名人比对
   - **签名有效** → 发 `WithdrawalRequested`，占这家的「已验证」额度桶，进 Cosign 判定。真用户的提款只会走这条
   - **签名无效**（签名人不是登记钥匙，或账户还没有钥匙）→ 不 revert，改发 `UnverifiedRequest`，占另一个很小的「未验证」额度桶（每家每 6 秒 1 个），由 **Trap** 的新 log trigger 接手：只查收款账户、收款地址是不是诱饵，是就上确认级，不是就什么都不做。RequestBoard 直接把这笔标成 unverified，它永远付不了款，不需要 CRE 给裁决
   - 为什么不直接 revert：诱饵账户的陷阱靠的就是「攻击者伪造诱饵账户的提款」这个事件，revert 就没有事件，陷阱也不会触发
   - **效果：** 伪造的请求再多，也碰不到真用户那条车道；后台被攻陷、攻击者狂发伪造请求试账户的时候，正常用户的提款照样走。这正是前一版做不到的
   - **未验证车道被塞满本身就是信号：** 诚实的后台几乎不会送出签名无效的请求（顶多是用户刚换钥匙、用旧钥匙签了）。RequestBoard 记下每家被拒的未验证请求数，Patrol 读到超过门槛就把那一家升到 L2（收紧，代价落在被攻陷的后台身上）
   - 额度分配：Cosign 只收已验证请求（A 每秒约 0.83、B 每秒约 0.67，和现在一样）；Trap 收未验证请求（两家合计每 6 秒最多 2 个）加上诱饵钱包的事件（很少），都在每个 workflow 每 6 秒 10 个的限流以内
   - 写 APPROVE 时仍再查一次签名人 = 当时的登记钥匙（防止提交后钥匙被换）

**改完之后 CRE 还能做什么（台上要讲清楚）：**
- 收紧：冻结、清零额度、把热金库扫回冷钱包、升警戒
- 放行一笔用户真的签过、但本来应该挂起的请求（关 4 到 7 被绕过）。钱仍然只会去用户签的地址、在用户签的期限内，而且有额度桶封顶
- 伪造的请求根本到不了 Cosign，CRE 想放行也没有裁决可写（未验证的请求在 RequestBoard 就标成永远不能付款）
- 金库之间与回冷钱包的移动（topUp 到兄弟热金库、sweepToCold）不经用户签名，但目的地是构造时写死的
- 冷钱包不在这个保证内：冷钱包由两位人员签名 + 时间锁管理（F8）

**Cosign 的关 1、关 3 保留**，当作第二道检查。改完后字段不一致的请求在 submit 就 revert，签名无效的请求走未验证车道，原因代码 11、31、32 在 E2E 里不会再出现，只能用 workflow 单元测试（WU）测；10_interfaces 第 6 节把这三个代码标为「防御性」。红队的 `forge`（伪造签名）预期改为：发出 UnverifiedRequest、没有裁决、请求标成 unverified；`forge-decoy` 预期改为：Trap 上确认级。

**正式版：** 用户改用 passkey（P-256）时，要选有 P-256 验签预编译的链，否则链上验签太贵。

**改哪里：**
- 10_interfaces：第 1 节（txHash 由谁算）、3.1（submit、两条车道、未验证额度桶、UnverifiedRequest 事件、kind 1）、第 9 节（Trap 加一个 log trigger 与它的读取预算；Trap 要读 secret DECOY_TAGS）、3.2（VERDICT 的 expiresAt 截断、txHashOf = 0 忽略）、3.3（execute 的 deadline）、第 6 节（11、32 标防御性）
- 31_phase1：RequestBoard、QuorumVault 的任务与测试
- 33_phase3：exchange-api 的 submit worker（不再算 txHash）；3.6 红队命令里「改字段」的预期改成 submit revert
- 40_verification：D14.1、D14.3 的 E2E 改为「submit revert」，Cosign 的字段比对改由 WU 测
- proposal §7、§8

**新检查：**
- D66（U + INV）：INV 的 handler 可以随意伪造 Forwarder 报告（模拟 CRE 被攻破）与人员签名，也会送 kind 1 请求。断言热、温金库的每一笔流出只会是三种之一：(a) 付给一份有效用户签名里的 (vault, token, to, amount, nonce)，而且在 deadline 之前；(b) topUp 到构造时写死的兄弟热金库；(c) sweepToCold 到 cold
- U：execute 超过 deadline revert；报告里 expiresAt 超过 deadline 时被截断；kind 1 的 VERDICT 被忽略

### F2：fail-slow 改成如实描述（意见 2）

**比赛版改法：** 只改文字，不改机制。

- proposal §10 改成：「CRE 停了：已批准、15 分钟内的提款仍可执行；新提款拿不到裁决，exchange-api 全部转人工（两人签名 + 排队）；额度不再补充。不放开、不锁死，但吞吐量降到人工能处理的量。」英文说法用 **fail-closed with a manual lane**，不要再用 fail-slow
- D27 名称同步改
- 42_performance 第 3 节的路线图 2（小额授权分级）补一句：这才是真正的 fail-slow。用户事先签一份小额授权，金库在链上验签 + 额度桶直接放行，不必等 CRE；CRE 停了小额照走，直到额度用完

**审查者建议「诱饵检查改成异步」：** 只在小额授权分级里成立。诱饵账户没有真用户的钥匙，攻击者签不出它的授权，所以诱饵账户本来就走不了小额车道；它的提款仍会进 Cosign，陷阱照常触发。比赛版保持「全部经过 CRE」。

### F3：首次登记钥匙（意见 3）

**思路：** 用链上已经存在的证据证明「这个账户是你的」，而不是靠等待或人工审核。劫持只有在账户里已经有钱时才有利可图，所以按证据分三级，大部分用户零等待。

**三级规则：**

| 情况 | 钥匙状态 | 能做什么 |
| --- | --- | --- |
| 账户里没钱（新用户：先登记、再充值） | 立即生效（active） | 全部。这时被抢先登记也偷不到东西 |
| 账户里有钱，登记时附上「充值钱包证明」 | 立即生效（active） | 全部。证明全部在链上核对，不经过后台，也不需要人员 |
| 账户里有钱，但证明不了（例如只用法币入金） | 暂定（provisional），KEY_PROVISIONAL_DELAY 后自动转为 active | 付到这个账户**以前付过的地址**：马上可以。付到新地址：notBefore = 暂定期结束，到时自动放行，不转人工 |

**充值钱包证明：**
- DepositVault 记下每个账户的充值钱包与各自的累计金额（低于 MIN_DEPOSIT 的充值不算，防止有人撒小钱干扰）
- 证明 = 用充值钱包对 KeyBinding 再签一次。条件：**这个账户所有达到门槛的充值都来自这一个钱包**（唯一充值钱包）
- 为什么要「唯一」而不是「任何一个充值过的钱包」：攻击者可以往受害者账户充一笔，让自己也变成「充值过的钱包」，再拿这个身份登记钥匙。要求唯一，攻击者充进去之后反而让这个账户失去「唯一」，退回暂定那一级，攻击者什么也拿不到（而且充进去的钱归受害者）
- 用户是从别的交易所提币充进来的（签不出那个钱包的签名），就落在暂定那一级

**被抢先登记时，真用户怎么夺回：**
- 账户的钥匙是暂定状态时，唯一充值钱包可以直接签一份「取代」，把暂定钥匙换成用户自己的，立即生效。比人员否决更去中心化，人员否决（CANCEL_QUEUED）仍保留当备用
- 已经是 active 的钥匙不能这样被取代，只能走原本的换钥匙流程（新钥匙签、排队、旧钥匙可取消）
- **金库付款前再核对一次签名人 = 当下的钥匙**（consumeVerdict 时查）。钥匙被换掉后，攻击者已经拿到的 APPROVE 也付不出去

**攻击者能拿到什么：**
- 抢先登记有钱的账户：只能把钱付到这个账户以前付过的地址（钱回到用户自己手上），或付到新地址但要等暂定期结束；这段时间真用户可以夺回，人员也看得到
- 一大批有钱的账户同时处于暂定状态，本身就是攻击信号：Patrol 每分钟读每家的暂定钥匙数，超过 KEY_BURST_MAX 就把那一家升到 L1
- register 只能由该 org 登记过的提交地址调用（KeyRegistry 加 orgId），并有链上的登记额度桶，否则任何人都能替随机账户登记，刷爆上一条的信号

**真的要等的用户：** 只用法币入金、从没提过款、又第一次提到新地址。只等一次、自动放行，不需要找客服。

**比赛版改动：**
- DepositVault 记充值钱包与金额，提供 soleDepositorOf(userIdHash)
- KeyRegistry：三级规则、provisional 状态、registerWithDepositorProof、replaceProvisional（由唯一充值钱包签）、orgId 与登记额度桶
- Receiver：钥匙是 provisional 时，付到 seenRecipient 以外的地址，notBefore 至少是暂定期结束；consumeVerdict 时核对签名人 = 当下的钥匙
- Patrol：暂定钥匙数的信号
- 「以前付过的地址」直接用合约已有的 seenRecipient
- 演示参数：KEY_PROVISIONAL_DELAY 10 分钟；正式版 24 到 72 小时
- **视频可以多一个场景：** 攻击者抢先登记、提款到自己的新地址（被延后）；真用户用充值钱包签一下夺回账户；攻击者那笔在付款时失败

**正式版：**
- 「充值钱包」来自链上：用户每个链的充值地址收到的转账，发送方就是充值钱包；充值地址和账户的对应关系放进交易所的余额承诺（F6）里，延迟生效，不信即时的后台
- 「账户里有没有钱」也用余额承诺判断，所以上线那天的现有用户（钱是以前存的）会正确地落在第二或第三级
- 「以前付过的地址」从交易所历史提款记录的承诺里来
- proposal §10 的边界补一条：只用法币入金的用户，第一次提到新地址要等一次

**新检查：**
- D67（U）：三级规则各一个测试；有两个达到门槛的充值钱包时不能用充值钱包证明；provisional 钥匙可被唯一充值钱包取代，active 的不行；非提交地址调用 register revert；超过登记额度桶 revert
- D69（U + E2E）：provisional 钥匙付到新地址时 notBefore ≥ 暂定期结束；付到以前付过的地址立即可以；钥匙被取代后，已拿到的 APPROVE 在 execute 时 revert；E2E 场景 `register-hijack --user --reclaim`
- WU：暂定钥匙数超过 KEY_BURST_MAX 时发 L1

**对现有场景的影响：** `register-hijack --user`（有钱的账户）的预期从「进入排队，人员 Cancel」改为「暂定钥匙、付新地址被延后、用户可夺回」；`--new`、`--self-fund`、`same-block`、`hop` 不变；`grief-deposit` 改成测「撒小钱不影响唯一充值钱包」。

### F4：诱饵地址在 Cosign 路径上的远程触发（意见 4 的剩余部分）

- 已修的部分不动：诱饵钱包只看转出，诱饵收款地址的链上触发只认「我们的金库付过去」
- **要修的是原因 43（收款地址是诱饵）：** 配合 F1 的两条车道：
  - 伪造的请求（未验证车道）：Trap 上确认级，和现在的效果一样
  - 签名有效的请求（Cosign）：只给 PENDING + 该账户 L1，不上确认级。被劫持钥匙的账户付到诱饵地址也落在这一类，钱不会动，人员会看到。正常用户不会付款到我们的诱饵地址，所以不影响诚实用户
- **被触发过的诱饵退役：** 标记 burned，从 DECOY_TAGS 拿掉（不再让 Cosign 对它上确认级），只留在 Trap 的「金库付款到诱饵地址」触发 B 里（那条要后台动用金库才会触发）。decoy-admin 提供 `rotate`：布新的诱饵、更新 CRE 配置与 secret
- proposal §9 的边界写明：能触发确认级的，只有掌握诱饵私钥、能指挥我们金库付款、或伪造诱饵账户提款的人，三者都表示攻击者已经在系统里

**新检查：** WU：收款地址是诱饵、签名有效 → PENDING + L1，不发确认级动作；签名无效 → 确认级。E2E：拿已 burned 的诱饵地址发一笔正常签名的提款，交易所不冻结。

### F5：加密与共识（意见 5）

已修，不改机制。只要重画 B3，并在 proposal §6 E 的文字里写明「nonce 与临时钥匙由 HMAC(K, …) 派生，同一事件在每个节点算出的密文都相同」。

### F6：关 5 的数据来源（意见 6）

**不照审查者说的「降成软信号」。** 关 5 是让「抢先登记钥匙」无利可图的那道锁；改成软信号，F3 的洞就重新打开。要保留硬检查，换掉数据来源。

**余额指什么：** 不只是充值，是交易所账本里这个用户的完整可用余额。

**比赛版：**
- 只算链上充值（DepositVault），因为演示里没有交易、法币这些。在 proposal、Console、视频里明确称为「余额承诺的简化替身」
- 演示里的用户全部是链上充值，所以比赛版没有任何用户被误伤
- 边界写明两件事，并说清楚正式版怎么消掉：用链上充值当余额来源，会误伤没有链上充值的用户，正式版改用完整余额；DepositVault 公开了每个账户的累计充值，正式版链上只放余额根

**正式版：延迟生效的负债承诺（proof of liabilities）**
- 交易所每 N 小时把所有用户余额做成 Merkle sum tree，只把根（含总额）写上链
- 新的根要等 LIABILITY_DELAY（例如 6 小时）才生效；Patrol 比对「新根的总额 − 旧根的总额」和这段时间链上的充值、提款净额，差太多就报警
- 根里的余额是交易所账本的完整可用余额：充值、法币买币、交易盈亏、内部转账、活动奖励都算在内
- 关 5 改成：本笔 + 快照之后已批准 ≤ 快照余额 + 快照之后链上的充值。证明由 Cosign 用 HTTP 向交易所 API 取，再对根验证；后台给的证明造不了假，最多给不出来（那就挂起）
- **照顾用户的几个细节：**
  - 快照之后新充的钱：链上看得到，直接加进可提余额，充了马上能提
  - 快照之后赚的钱（交易获利、奖励）：要等下一个根生效（根每小时一个、延迟约 1 小时，所以约 1 到 2 小时）才算进去。在那之前，超出的部分给 notBefore = 下一个根生效的时间，到时自动放行，不转人工
  - 倍数：proposal 原本的 1.5 是为了容纳交易获利。改用完整余额之后不需要放宽，1.0 就对了：不能提超过你真正拥有的钱。STATUS 里「关 5 倍数 1.5 → 1.0」那条待决定就此结案
- 效果：攻击者想放大某个账户的余额，必须提前几小时写一个假根，而且总额对不上会被发现；法币用户的余额自然包含在内
- 隐私：链上只有根；用户余额只有 DON 节点在验证时看到
- **它挡不住的事（路线图要写明）：**
  - 只看总额挡不住「挪移」：新根把被劫持账户的余额调高、别人的调低，总额不变。要靠用户用后台碰不到的客户端核对自己在根里的余额（inclusion check），这是必要条件，不是加分项
  - 根是不可信的交易所写的，延迟生效只是争取时间，不是证明
- **链上竞态：** 合约写 APPROVE 时复查关 5 需要知道余额，但余额不能上链。做法是在 Receiver 里给每个用户一个「未裁决」槽位，同一用户同时只能有一笔未裁决的请求；裁决写入或用户的 deadline 过了就清掉（避免 ScoreConflict、孤儿裁决、过期跳过等情况让用户卡住）。放在 Receiver 而不是 RequestBoard，因为 RequestBoard 不依赖 Receiver（第二轮审查的决定）
- 「本期已批准」定义为：上一个已生效根的快照区块之后的已批准总额，换根时才不会算错

### F7：指纹的误报（意见 7 的剩余部分）

- 指纹不含地址这件事不改（换地址也认得出是同一手法）
- **改 λ：** 指纹的 λ 从 2303 降到 1500，单独命中到不了 L1（2303）；要再加一个独立信号（例如新收款地址 900、钥匙刚生效）才会进 L1。和 10_interfaces 里「单独命中不改变决定」的说法一致
- D13 的 `hop --new-addr` 预期不变：攻击者在 B 换新地址、同样的试探金额，「指纹 + 新收款地址」一起出现才到 L1
- 新增 WU：正常用户在指纹有效期内付到自己常用的地址、金额落在试探区间，分数不到 L1
- 重画 B2、B3 时写对公式

### F8：人员签名防盲签（意见 8）

**比赛版改法：每种 OfficerAction 改成字段明确的 EIP-712 类型**，硬件钱包和 MetaMask 会逐字段显示，签的人看得到钱去哪里：

| 动作 | 新的类型（主要字段） | 合约核对 |
| --- | --- | --- |
| 人工放行 | `ManualApprove(bytes32 requestId, bytes32 userIdHash, address vault, address token, address to, uint256 amount, uint256 userNonce, uint64 userDeadline, uint256 officerNonce, uint64 sigDeadline)` | queueManual 带完整的 (request, intent, userSig) 当 calldata，合约用 contentHash 验证；字段与请求一致；用户签名人是登记钥匙；userDeadline 未过 |
| 冷钱包排队 | `ColdQueue(address token, address to, uint256 amount, uint256 nonce, uint64 deadline)` | 直接用这些字段排队，不再签 hash |
| 延长冻结 / 降警戒 / 降冷钱包延迟 / 重设资产检查点 | 各自的类型：`ExtendFreeze(vault, until)`、`LowerAlert(orgId, level)`、`LowerColdDelay(coldVault, delay)`、`ResetAssetCheckpoint(orgId, token, assetValue)` | 同上 |
| 计划内调拨 | `PlannedOp(address vault, address token, uint64 windowStart, uint64 windowEnd, uint256 perMinuteCap)` | 同上 |
| 配置变更 | 常用的几种各一个类型（例如 `AddVault(address vault)`、`SetCap(address vault, address token, uint256 cap)`）；其他一律走通用的 `Config(address target, bytes4 selector, bytes args)`，并在 Console 与 CLI 都显示解码后的参数 | ConfigTimelock 核对 |
| 取消排队 | `CancelQueued(bytes32 queueId)` | 一人即可，只会让事情变慢，所以允许 hash；Console 与 CLI 都要显示被取消的那一项内容 |

**每个类型都带 officerNonce 与 sigDeadline**（现在 OfficerAction 的 nonce、deadline），防止签名重放。人工放行里用户的 nonce、deadline 另取名 userNonce、userDeadline，避免混淆。

**人工放行和「裁决只写一次」的关系：** 人工放行的那笔通常已经有 Cosign 写的 PENDING。不覆盖它（不变量 I2 不改）：Receiver 另存 `manualApproved[txHash]`，consumeVerdict 接受「VERDICT 是 APPROVE」或「manualApproved 为真」两者之一，各自只能用一次。I2 的文字补一句：人工放行另存，不改原裁决

**流程（写进 runbook，视频也照这样演）：**
- 两位人员用**不同的客户端**：一位用 Console，另一位用独立的 CLI（`officer-cli`），它直接读链、自己解码请求，不经过 Console 的服务端
- 都在硬件钱包（或至少 MetaMask 的 EIP-712 明文画面）上核对收款地址与金额再签
- Console 只是辅助，不是信任来源。Bybit 的教训就是三个人看同一块被篡改的屏幕

**新检查：** D68（ST）：EIP-712 类型里，凡是会让钱移动的动作，代币、收款地址、金额都必须是明文字段，不能只有 hash；U：字段与请求不一致时 revert。

### F9：非 EVM 链与 Bitget 事实（意见 9）

**比赛版：**
- pitch 主动讲：「EVM 上能拦；其他链目前能在约一分钟内发现，并立刻收紧 EVM 这边」。XRP 诱饵仍是 P2，有做才讲
- **更正 Bitget 的数字**（以 BlockSec 为准，进视频前再对一次原文）：
  - 2026-09-24，损失约 3.875 亿美元，13 种资产、12 条链，26 笔流出；XRP 是损失最大的单一链
  - 私钥没被盗，冷钱包没事：攻击者写入伪造的提款指令、绕过风控，正好是我们假设的威胁模型
  - 18:31 UTC 两笔测试转账（0.84 ETH、93 TRX），18:58 大额流出，19:05 对账系统发现
  - 公开可见的冻结约 84 万美元，约 0.2%
  - 要改的地方：41_evaluation 的「约 12 个钱包、11 条链」改为原文说法；proposal 与 STATUS 里「头 18 分钟约 2.28 亿美元」找不到原文出处，**删掉**，改用上面的时间线
- 重画 B2、B3，写进已修好的规则（诱饵只看转出、只认我方金库付款、指纹不含地址、HMAC 派生的 nonce）

**路线图：** 非 EVM 链靠交易所的 MPC 或 HSM 签名服务。把 CRE 的裁决接成签名前的策略检查（co-signer 回调），没有 APPROVE 就不签。这仍然依赖交易所的签名设施，但比只能事后发现好。

## 3. 落实顺序与工作量

| 顺序 | 项目 | 理由 | 估计（文档 + 检查） |
| --- | --- | --- | --- |
| 1 | F1 | 最根本：改完 CRE 单独付不出钱，伪造请求也挤不掉真用户 | 中到大（多一条车道与 Trap 的一个 trigger） |
| 2 | F8 | 和 F1 共用「人工放行带完整请求」；防盲签是 Bybit 的直接教训；officer-cli 一并做 | 中 |
| 3 | F4、F7 | 都是「真用户的正常操作会造成误报」，评委一试就出事 | 小 |
| 4 | F9 | 事实更正要在任何对外材料之前完成；重画两张图 | 小 |
| 5 | F2 | 只改文字 | 小 |
| 6 | F3 | DepositVault 记充值钱包；KeyRegistry 三级规则、暂定状态、夺回；Receiver 的暂定限制与付款前核对；Patrol 一个信号；一个新场景 | 中 |
| 7 | F6 | 比赛版只改边界文字；正式版写进路线图 | 小 |
| 8 | F5 | 只在重画的图与 proposal 文字里写对 | 极小 |

全部改完后跑一次独立审查，只看这次改动有没有带出新问题，再打包。

## 4. 要团队决定的

已定（2026-10-05）：
1. F1：签名无效的请求不拒绝、也不能占用真用户的额度，改成两条车道（第 2 节 F1 第 6 点）
2. F3：按证据分三级。新用户零等待；有钱的账户用唯一充值钱包签名立即生效；证明不了的，钥匙暂定，付以前的地址立即、付新地址暂定期满自动放行；真用户可用充值钱包夺回
3. F6：比赛版只算链上充值（写明是简化）；正式版用交易所账本的完整余额，快照后的充值马上可提，获利等下一个根自动放行，倍数 1.0
4. F8：做独立的 `officer-cli`

## 5. 台上一句话（被问到时）

- 「CRE 能不能偷钱？」 → "No. Every payout from the hot and warm vaults needs the user's own signature, checked on-chain, within the user's deadline. CRE can hold, tighten, or push funds back to cold. The worst it can do is release early a withdrawal the user really signed."
- 「CRE 停了怎么办？」 → "New withdrawals fall to a two-officer manual lane. Nothing opens up, nothing locks up. A signed small-amount allowance is on the roadmap for true fail-slow."
- 「人员签名会不会像 Bybit 一样被骗？」 → "Officers sign typed fields, not hashes: the hardware wallet shows the recipient and amount. And the two officers use two different clients."
