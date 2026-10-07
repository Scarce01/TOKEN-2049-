# 40 设计一致性验证：证明做出来的东西和设计一样

## 1. 原则

1. **每一条设计要求都有编号（D01 到 D65，D40 已并入 D12），每一条都至少有一个自动检查。** 检查失败就代表实现和设计不一致，不代表测试写错了。
2. **验证读的是状态，不是回执。** 交易成功、`txStatus` SUCCESS 都不算证据；只有读合约状态、读数据库权限、读打包产物得到的结果才算。
3. **测试归设计所有。** 不能为了让检查通过而改断言。实现必须偏离设计时：先改 proposal_v4 或接口文档，在 STATUS.md「设计变更」记一条（写明 D 编号、原因、谁同意），再改检查。
4. **每个阶段结束都由一个没写过这些代码的审查者对照本矩阵审一次**（第 6 节）。

## 2. 检查类型

| 代号 | 类型 | 工具 | 在哪跑 |
| --- | --- | --- | --- |
| U | 合约单元测试 | forge test | 本地、CI |
| WU | workflow 单元测试 | bun test；判定逻辑写成纯函数（gates、sprt、taint、tags），输入是一个 `Reads` 对象，handler 只负责读取与写报告；测试用 mock 的 Reads | 本地、CI |
| INV | 合约不变量 / 模糊测试 | forge invariant（handler 模式） | 本地、CI |
| ST | 静态检查 | 字节码扫描、权限清单、Slither、lint 规则、grep | 本地、CI |
| DET | workflow 确定性 | 同一触发 simulate 两次，比对报告 | 本地（需要 CRE 登录） |
| DB | 数据库权限 | SQL 测试，用各角色与 anon key 连接 | 本地、云端 |
| BUNDLE | 打包产物扫描 | 扫 Next.js 构建产物与 exchange-api 源码 | 本地、CI、部署后 |
| E2E | 测试网场景 | `scenes/*.sh` 与 redteam 命令，结束后读链上状态断言 | 测试网 |
| OFF | 离线分析 | Python | 本地 |
| REV | 独立审查 | 新的 Claude Code 会话，按第 6 节模板 | 每阶段结束 |

## 3. 设计要求矩阵

| ID | 设计要求 | 出处（proposal_v4） | 检查 | 阶段 |
| --- | --- | --- | --- | --- |
| D01 | 后台被攻陷也关不掉收紧：Trap 路径不经过交易所后台 | §1、§3 洞察 2 | E2E：停掉 exchange-api、撤销 exchange_a_app 权限后 probe，仍然收紧；wipe 后 Console 不变。ST：workflows/ 不引用 exchange-api 或 Supabase | 2 |
| D02 | 诱饵钱包的代币流出 = 确认级 | §4 | E2E：probe；U：Trap 报告解码后是完整确认级动作包 | 2 |
| D03 | 原生币诱饵被转走，在一个执行间隔内触发；XRP 诱饵同理（若做） | §4、§5 时间线 | E2E：probe --native，测 Patrol 发现时间 ≤ 实际执行间隔 × 2；另测「先转入再转走、仍高于 floor」也能被窗口检查抓到 | 2、6 |
| D04 | 碰诱饵账户：后台只看到 PENDING，链上同时确认级 | §4、§5 | E2E：forge-decoy；断言 exchange_a.withdrawals 只有 pending、链上收紧全部生效；U：VERDICT 的 publicReason = 0 | 3 |
| D05 | 假门槛指纹是强信号，进 L2，不触发链上收紧 | §4、§6 E | E2E：probe-threshold（35_phase5.md 完成标准）：解密分数 ≥ 4605、sealedReason 有 72、没有 Tightened、后续小额付新地址也延迟（47：D2 后自动付款） | 5 |
| D06 | 钱付到诱饵地址 = 确认级；陌生人转入诱饵地址不触发 | §4 | E2E：pay-decoy-addr 触发。陌生人转入：**直接对那笔交易跑 `simulate workflows/trap --evm-tx-hash`**，断言 workflow 不写报告、链上状态不变（不能只靠 sim-runner 自己的过滤，否则会掩盖 Trap 的错误） | 2、3 |
| D07 | 诱饵凭证被用 = 确认级（P2） | §4 | E2E：use-api-keys | 6 |
| D08 | 确认级六个动作全部生效：冻结温金库、热金库额度清零、撤回冷钱包、警戒 4、冷钱包时间锁拉长、写名单 | §5 | U：逐项读状态；E2E：probe 后 `redteam status` 逐项断言；INV：I5（冷钱包 delay 只升） | 2 |
| D09 | 冻结有期限；只能延长；延长要两人签名 | §5、§10 | U：FREEZE 不缩短；extendFreeze 一人失败、两人成功；到期后 isFrozen 为假。INV：I3 | 2、3 |
| D10 | 收紧用 LATEST，放宽用 FINALIZED，且放宽有链上兜底 | §6 J | workflow 单元测试：mock 成 LATEST 干净、FINALIZED 不干净（以及反过来），断言不补额度、不 TOPUP；U：alert = 4 或冻结时 refillQuota、topUp revert；ST：Trap 的 trigger 与 Cosign 唯一的 handler 用 LATEST，Cosign 只有一个 log trigger | 2、6 |
| D11 | 警戒棘轮：自动只升；同级延长；降级只能到期或两人 + 排队 | §5、§6 H | U；INV：I4 | 1、3 |
| D12 | 共享名单：附证据；按证据去重；只标可疑、没有封锁或删除功能；72 小时有效、续期要新证据；阶段 5 起要 Merkle 证明；衍生条目要有效父条目 | §5、§6 C、§6 H | U：去重、拒绝 address(0) 与我方合约、无效证明被拒、同一证据续期无效、过期后 isSuspect 为假、父条目过期时衍生条目被拒；ST：权限清单里 ThreatRegistry 没有 remove / block 类函数；INV：I8 | 2、5 |
| D13 | 第二家：同地址转人工；跟随等级贡献最多 L1；正常用户不受影响 | §5、§6 H、§9 | E2E：hop、hop --new-addr、hop --honest | 4 |
| D14.1 | 关 1：txHash 不符 → REJECT | §7 | U + E2E：送字段被改的请求 | 3 |
| D14.2 | 关 2：Safe 交易 / delegatecall / 不允许的代币或金库 → REJECT | §7 | E2E：bybit（阶段 3 构造，阶段 6 用主网真实交易） | 3、6 |
| D14.3 | 关 3：签名人不是登记钥匙、字段不符、过期 → REJECT | §7 | E2E：forge、改字段、过期 | 3 |
| D14.4 | 关 4：诱饵先于各关检查；名单命中 → PENDING | §4、§7 | E2E：forge-decoy（签名错也触发陷阱）；hop | 3、4 |
| D14.5 | 关 5：已批准 + 本笔 ≤ 充值，链上再检查一次 | §7 | E2E：register-hijack --new、--self-fund；**same-block --n 3**（同一区块多笔，只有一笔能 APPROVE） | 3、5 |
| D14.6 | 关 6：数据源不一致、价格过期 → PENDING | §7 | workflow 单元测试（注入不一致的读取）；E2E：MockV3Aggregator 设为过期 | 5 |
| D14.7 | 关 7：隐藏上限 × 等级 | §7、§6 D、§6 E | workflow 单元测试：各等级的上限；E2E：L2 账户付新地址 → 延迟 D2（47） | 5 |
| D15 | 关 4 到 7、静默分级对外不可区分 | §5、§7 | U：PENDING 的 VERDICT 一律 publicReason = 0、expiresAt = 0、sealedReason 长度固定；E2E：对比 42、51、71 三种 PENDING 的链上数据，除 txHash、requestId、userIdHash 与密文内容外完全同构 | 3、5 |
| D16 | 裁决绑定 txHash（含 requestId）、一次性、有期限、只写一次 | §7 | U；INV：I2 | 1、3 |
| D17 | 金库只会转账：没有 delegatecall、selfdestruct、callcode，不可升级 | §7 | ST：反汇编部署字节码（跳过 PUSH 数据与结尾 CBOR metadata）扫 0xf4、0xff、0xf2；没有 proxy 模式 | 1 |
| D18 | 撤资只能到冷钱包；TOPUP 只能到兄弟热金库 | §5 | U；INV：I1 | 2、6 |
| D19 | Receiver 只认 Forwarder + 白名单 workflow（owner、编码后的 name）+ 各自允许的 kind；SIM 守卫 | §8 | U：每种拒绝情况。E2E（方式 A）：由队友另一个 CRE org 部署一个同名 workflow 发报告，断言 Receiver 状态不变（org 只有 3 个 workflow 名额，不能用自己的第 4 个） | 1 |
| D20 | 没有 owner 后门：配置只走 ConfigTimelock；部署私钥部署后没有权限；一次性 initialize 调用后锁死 | §8、§10 | ST：权限清单快照（4.2）；U：部署私钥调用每个配置函数都失败；第二次 initialize 失败；INV：I7 | 1 |
| D21 | 隐藏门槛按期派生、每期承诺、期满揭示且核对通过 | §6 D | U：揭示不符 revert；E2E：跨两个 epoch，读 DecoyCommit 的承诺与揭示 | 5 |
| D22 | SPRT 阈值 ln 10 / ln 100 / ln 900；弱信号只延迟与转人工，不封锁 | §6 E | workflow 单元测试（共用向量）；ST：Cosign 只有诱饵命中会产生确认级动作（代码路径检查） | 5 |
| D23 | 分数加密存放；每次裁决都重写；同一事件重跑结果相同；不重用 nonce | §6 E | U：通过关 1 到 3 的 VERDICT 都伴随 SCORE，REJECT 不带 SCORE（伪造签名的请求不能替别人加分）；E2E：同一用户连续两笔，测试工具解密断言 Λ2 = decay(Λ1) + λ；DET：同一事件重跑密文相同；单元测试：明文不同时 nonce 不同 | 5 |
| D24 | 额度桶：补充有上限 r_max、epoch 递增、对账干净才补、不超过 cap；最坏损失上界 | §6 G | U；INV：I6（含 r_max × 间隔）；OFF：上界计算 | 6 |
| D25 | CUSUM 只降补充速度，不封锁 | §6 F | 代码路径检查；E2E：灌一波流出触发报警，断言只有补充量减半、没有 Tightened | 6 |
| D26 | 对账：资产守恒（热 + 温余额 + 对外累计转出只增不减）；运维 EOA 代币只去允许地址 | §6、§7 | WU：V 变小 → 确认级，V 不变或变大 → 不动作；E2E：正常流量 1 小时零误报；从运维 EOA 转去非允许地址 → L2。「每个 Executed 都有已用的 APPROVE」由 I1 证明，不另查日志（STATUS 设计变更） | 6 |
| D27 | fail-slow：CRE 停了不放开也不锁死 | §10 | E2E：stop-cre 后新请求没有裁决、额度不再补、两人签名的慢车道仍可放行 | 3、6 |
| D28 | 诱饵与真东西分不出来（在声明的边界内） | §6 B | DB：exchange_a 里诱饵与普通行字段结构一致、都有钥匙、都有链上充值；OFF：AUC 上界 ≤ 0.65；已知破绽（诱饵 EOA 的 nonce 永远是 0、是 EOA 而真热钱包是合约）写在 proposal 边界里，不算通过条件 | 1、2、5 |
| D29 | 诱饵清单不泄露 | §9、CLAUDE.md 规则 2 | DB：anon、exchange_*_app、非 officer 用户都读不到 traps；anon、authenticated、exchange_*_app、ponder_svc 都读不到 ponder_quorum 以外的 Quorum 表（ponder_svc 读不到 traps）；anon、authenticated 读不到 ponder_quorum；console_svc 写不了 ponder_quorum 与 traps；ponder_quorum 不在 PostgREST 公开的 schema 里；BUNDLE：构建产物、exchange-api、git 历史与工作树、提交进仓库的 CRE config、服务与 workflow 日志里扫不到诱饵地址、诱饵 userIdHash | 1、2、4、8 |
| D30 | workflow 确定性 | CRE 共识要求 | DET：三个 workflow 各取代表性触发 simulate 两次，报告逐字节相同（包括 issuedAt，它取自区块头）（cron handler 用 config 覆盖固定区块号）；seal 输出相同。ST：仓库里（sim-runner、scenes、scripts、package.json）找不到 `--limits none` 或放宽的配额文件；lint 禁用 Date.now、new Date、node:crypto、fetch、process.env、Promise.race、Promise.any、parseFloat；EVM read 必须显式指定区块号 | 1 起每阶段 |
| D31 | 溯源排除交易所、DEX、跨链桥、我方合约 | §6 I | workflow 单元测试：排除清单里的地址不被写入；OFF：Bitget 一跳结果附排除说明 | 6 |
| D32 | 每个数字都有来源类型 | §10 | ST：metrics 每行 source 非空；Console 的数字组件必须带 source 属性（组件类型检查） | 2 起 |
| D33 | 只动本交易所自己的钱 | §10 | INV：I1；ST：ThreatRegistry 不被任何金库读取 | 2 |
| D34 | 后台只看到 APPROVE / REJECT / PENDING + 编号 | §5、§7 | ST：exchange-api 不 import seal / unseal；E2E：各种 PENDING 下 exchange_a.withdrawals 的内容格式一致 | 3 |
| D35 | 人工通道：两人签名 + 排队 + 一人否决；有充值账户的首次钥匙登记要排队 | §5、§10 | U；E2E：register-hijack --user | 3 |
| D36 | 陷阱触发到链上收紧，目标一分钟内 | §5 时间线 | E2E：trap_to_freeze_seconds 中位数 ≤ 60（方式 B 下若做不到，记录实测值并在 STATUS 说明，不算隐瞒） | 2 |
| D37 | 配置漂移 → 冻结 | §7 | E2E：经 ConfigTimelock 改一个金库的 cap 后，Patrol 发现 configHash 不符 → FREEZE（Patrol config 的固定值不同步时触发，验证检测本身） | 6 |
| D38 | 多链对账（非 EVM 链 60 秒内对上裁决） | §7、§12 | 比赛版范围外：在 STATUS「设计变更」记为 waived，只做 XRP 诱饵（D03）；视频不声称支持 | 6 |
| D39 | 诱饵命中概率模型 | §6 A | OFF：公式结果与蒙特卡洛模拟（10 万次）差异 < 1%；策略 1、2 的模拟结果与公式一致 | 5 |
| D41 | 活性：每个请求都有裁决 | §5 | E2E：load-normal 50 笔，请求数 = 裁决数 | 3 |
| D42 | L1 延迟放行；L2 新地址或大额延迟 D2、L3 延迟 D3，都自动放行（47） | §5、47 | workflow 单元测试；U：APPROVE 在 notBefore 前执行 revert；E2E：e2e-prevention 情况 D（时间到自动付款） | 5 |
| D102 | 47 R2：大额付新地址延迟；规则可影子运行，影子只记日志、不改裁决；合约 floor：CRE 说马上放行也至少等 largeNewDelay，付过的地址不受影响 | 47 第 3、5 节 | workflow 单元测试；U：合约 floor 四个测试；E2E：e2e-prevention 情况 E | 5 |
| D103 | 一位人员可以暂停单笔已放行的提款，最多 holdMax、到期自动解除、同一笔要等 holdMax 才能再暂停，暂停期间裁决不会过期；两位人员才能取消 | 47 第二阶段、46 第 12 节 | U：HOLD 与 CANCEL 五个测试（含变异测试）；E2E：e2e-prevention 情况 F | 5 |
| D105 | 延迟的放行到期后，不靠交易所后台也会付款：独立的 keeper 送 execute（没有判断权，合约照样检查）；后台遇到「还没到时间、暂停、额度、冻结」改成稍后重试，不再标失败 | 47 第 9 节 3.1 | keeper 单元测试；E2E：e2e-prevention 情况 D 由 keeper 付款 | 5 |
| D111 | 换钥匙要目前的钥匙与新钥匙共签才立即生效；只有新钥匙的找回要等 recoveryDelay，第二因素能缩短到 keyChangeDelay 或取消，目前的钥匙也能取消；有余额后登记第二因素要等、目前的钥匙可取消（修安全审查 High 3） | 46 第 5、6.3 节、3.7 | U：KeyRecovery.t.sol 六个测试 | 5 |
| D112 | R7 受保护车道：冻结或确认级期间，只有「成熟地址 + 小额 + 独立额度 R」放行，其余照常被挡；两人联名仍被冻结挡；SWEEP 留 reserve；默认关。参数按 token，开启时 matureAge > 0、reserve ≤ cap，从没付过的地址永远不算成熟 | 47 R7；STATUS 设计变更 D112；审计 2026-10-07 | U：ProtectedLane.t.sol 十二个测试 | 6 |
| D113 | 深层溯源上链：Trek 只提议；CRE verify-edge 逐条读 receipt，只有「确实从 suspect 转出、from/to/金额相符、父证据有效、金额不低于下限」的边才写衍生 THREAT；被攻陷的 Trek 不能用非 suspect 的转账标记无辜地址；衍生 suspect 的提款为 PENDING 42 | docs/36 6.4；STATUS 设计变更 | WU：patrol/test/edges.test.ts；E2E：`pnpm demo:trace`（reports/scenes/fork_trace_e2e.json） | 6 |
| D109 | passkey 付从没付过的地址至少等 passkeyNewDelay（CRE 说马上放行也一样）；付过一次就不再等；钱包签名不受此限 | 46 第 5 节、3.6 | U：Passkey.t.sol 两个测试；E2E：e2e-prevention 情况 H（延迟后由 keeper 付款） | 5 |
| D110 | 换钥匙以后，旧钥匙签的、还在排队的放行不付款（KeyChanged）；没换钥匙照常；第一次付款的时间记在链上，之后不变 | 46 第 6.1、6.3 节、3.6 | U：KeyChange.t.sol 三个测试 | 5 |
| D108 | 通知不经交易所：notifier 只读链上事件，把延迟、暂停、拒绝、取消、已付款告诉用户（金额、收款地址、还要等几分钟、怎么取消）；它的数据库角色读不到诱饵清单 | 47 第 9 节 3.5、46 第 5 节 | U：compose 四个测试；DB：notifier_svc 读不到 traps、只能读 notify_channels；交易所与 anon 读不到投递地址 | 5 |
| D107 | passkey（P-256 / WebAuthn）能登记、能签提款并付款；错的 challenge、高 s、格式错误的 blob 都记 signer 0 且不 revert；钥匙 id 两边算法一致；软件认证器签的 blob 能被合约验过 | 47 第 9 节 3.4、46 第 5 节 | U：Passkey.t.sol 六个测试；SH：keyId 向量、blob 编码；E2E：e2e-prevention 情况 H（软件 passkey 走 RequestBoard、Cosign、金库） | 5 |
| D106 | 用户能用登记的钥匙取消自己排队中的提款：错的钥匙、过期签名、已付款或已取消的都被拒；签名只对一笔有效；取消后金库拒付、keeper 不再送 | 47 第 9 节 3.3、46 第 9 节 | U：UserCancel.t.sol 五个测试；向量：cancelDigest 两边一致；E2E：e2e-prevention 情况 G | 5 |
| D20（补） | Receiver 的 desk-only 原语只认 initialize 时写死的 OfficerDesk；对 Receiver 地址签的人员签名在 desk 上无效；desk 没有 owner、没有配置 | 10_interfaces OfficerDesk 节 | U：Desk.t.sol 四个测试（含变异测试：拿掉 onlyDesk 会被抓到）；INV：I7 的攻击者也会呼叫 desk 原语 | 1 |
| D104 | 非人工放行的出金受每小时、每天上限约束，上限只能经 ConfigTimelock 改 | 47 R8 | U：三个窗口测试 | 6 |
| D43 | Timeline 从第一笔测试转账开始 | §11 2:15 | E2E：s5_timeline 读 Timeline 服务端路由的第一条 = probe 的交易 hash（来自 traps.tripped_tx） | 4 |
| D44 | 指纹与弱信号对正常用户的误报率 | §11 测量 | E2E：load-normal --fingerprint，记录 false_pending_rate | 5 |
| D45 | 触发后攻击者还能拿走的金额 | §11 测量 | E2E：redteam race，记录 extractable_after_trigger；热、温金库为 0 | 2 |
| D46 | AWS 上的告警真的会响 | 38_phase8_aws.md | E2E（aws）：故意让一份报告失败、停掉 indexer（Ponder），各自在 5 分钟内收到告警 | 8 |
| D47 | Console 的当前状态来自链上，不来自数据库 | §8 | E2E：停掉 indexer（Ponder）并清空 ponder_quorum 的表，Control status 页的冻结、警戒、额度仍然正确 | 2 |
| D48 | 数据来源不一致时不采取动作（只会 PENDING，不会收紧也不会放行） | 41 §5 第 5 层 | WU：Trap 的收据与触发日志不符 → 不写报告；关 6 不一致 → PENDING。E2E：把 NOWNodes 换成返回篡改数据的代理，断言 PENDING 61、没有 Tightened | 5、6 |
| D49 | 运维流量重放时诱饵触发次数为 0 | 41 §4 第 3 条 | E2E：scenes/ops_replay.sh；decoy_false_trips = 0 | 6 |
| D50 | 定点数结果与浮点参考实现一致 | 41 §5 第 1 层 | WU：SPRT、衰减、CUSUM 的整数实现与 Python 浮点参考比对，误差在允许范围（SPRT ≤ 1 milli-nat） | 5、6 |
| D51 | 溯源回测：召回率可报告、结果跨数据来源逐字节一致 | 41 §2 | OFF：trace_bybit.py 产出召回率 @1、@2、精确率下界、跨链断点；3 个数据来源输出 hash 相同 | 6 |
| D52 | 攻击者策略模拟有结果 | 41 §3 | OFF：策略 1、2、4 各 ≥ 1,000 次，结果写 sim_runs | 5 |
| D53 | 分数可解释：每个信号贡献多少分看得到 | 41 §4 第 5 条 | U：sealedReason 解开后含每个信号的 λ；E2E：Cases 页显示明细且加总等于分数 | 5 |
| D54 | 误报用「每万笔延迟几笔、平均多等多久、每天人工复核几笔」报告 | 41 §6 | OFF：正常用户模拟器输出三个指标并写 metrics | 6 |
| D55 | CUSUM 按每周 168 个时段建基线；计划内调拨排除；单独报警只做软动作，加上第二个独立信号才升级 | 41 §4 第 4 条 | WU：同一流量在不同时段的判定不同；有 PLANNED_OP 时不报警；只有 CUSUM 时 org 警戒不变 | 6 |
| D56 | 正常负载下不丢请求；后台淹没不了 Cosign | 42 §3 | E2E：load-normal --rate 1.0 --minutes 10（超过 A 的额度桶，多出的被 RequestBoard 拒绝、退避重试）；链上接受的请求数 = 裁决数；停止后 10 分钟内积压归零；记录 Cosign 排队延迟与实际接受速率。方式 B 改用 sim-runner 实测上限，STATUS 记一条 | 3 |
| D57 | 每一步延迟都有实测 | 42 §2 | E2E：metrics 里 lat_include、lat_trigger、lat_exec、lat_report、lat_execute 都有值，来源 testnet_measured | 2、3 |
| D58 | CUSUM 检查点 + 重算等于逐分钟计算 | 42 §4、36 6.3 | WU：同一段 outRing 流量与同一组 PLANNED_OP（含中途过期、中途新登记的），「每分钟算一次」与「从任意检查点重算」的 (S, alarm) 逐字段相同；跨过 gap 时 gap = true。U：PatrolState 拒绝 minute 不大于现有检查点的写入；outRing 换分钟时覆盖正确 | 6 |
| D59 | Console 读链有缓存 | 42 §5 | E2E：Control status 页打开一分钟，RPC 调用次数 ≤ 区块数 × 2 | 2 |
| D60 | 一天的数据量在预算内 | 42 §6 | E2E：用 D56 那次运行，按比例推算每天新增的行数与库大小，写 metrics | 3 |
| D61 | 对账不读日志；误报不会直接冻结 | 36 6.1 | ST：reconcile handler 对金库不调用 filterLogs；WU：patrolView 失败时不产生任何动作；只有锚点看到 V 变小 → 只做 QUOTA_ZERO + L2；SAFE 也看到 → 确认级 | 6 |
| D62 | 后台淹没不了 Cosign；每个请求最终都有裁决 | 10 §3.1 | U：同一 org 超过额度桶 revert SubmitRateLimited，另一个 org 不受影响；resubmit 的内容 hash 对不上时 revert，未满 RESUBMIT_AFTER 时 revert；verdictRing 不会被晚到的旧分钟覆盖；Receiver 部署分钟之前的分钟不计积压；WU：提交超过 BACKLOG_AGE 仍无裁决的请求数 > BACKLOG_MAX 时不补额度并发 L1；E2E：S10 的结论写进 STATUS | 3、6 |
| D63 | 重组与换 requestId 都不会让同一份签名付两次 | 10 §3.2、§3.3 | U：txHashOf(requestId) 对不上的 VERDICT 被忽略（VerdictOrphaned）；同一 (userIdHash, nonce) 第二次 execute revert；APPROVE 写入时 signerOf ≠ keyOf 改存 PENDING 31 | 3 |
| D64 | 分数不会被并发请求互相覆盖，也不会因此误报 | 10 §4 kind 9 | U：prevHash 对不上时跳过同一份报告的 VERDICT（ScoreConflict）；同一 (scoreKey, requestId) 重跑时安静忽略、不发 ScoreConflict；SCORE 排在 VERDICT 后面时只跳过这两个 action，同一份报告的收紧动作照常执行；E2E：同一用户 1 秒内两笔请求，第二笔重发后的分数 = 两个信号都累积 | 5 |
| D65 | 资产守恒检查点可信 | 36 6.1、10 §4 kind 14 | U：ASSET_CHECKPOINT 的 assetValue 不能变小（vaultSetHash 变了或 RESET_ASSET_CHECKPOINT 之后除外）、safeBlock 递增；RESET 要两人签名并排队 MANUAL_DELAY，按 (org, token)；vaultSetHash 由合约自己算；INV：任何不经 execute / sweepToCold / topUp / fund 的调用序列都不改变 V；E2E：经 fund() 注资不触发；直接 transfer 进金库不触发；红队用测试专用的漏洞金库（只在 Anvil）偷走一笔 → 先软收紧、SAFE 后确认级 | 6 |

这份矩阵证明「实现符合设计」。「设计本身站得住」的证据（回测、对抗模拟、误报指标）在 41_evaluation.md，测试金字塔的五层也在那里对应到这里的检查类型。

## 4. 关键检查的细节

### 4.1 合约不变量（forge invariant，handler 随机调用所有外部函数，包括伪造的 Forwarder 与随机人员签名）

对应关系：I1 → D18、D33；I2 → D16；I3 → D09；I4 → D11；I5 → D08；I6 → D24；I7 → D20；I8 → D12。I1、I2、I3、I6、I7 在阶段 1 建好，其余随功能加入。

| # | 不变量 |
| --- | --- |
| I1 | 金库余额只会因四种原因减少：消耗了 APPROVE 的 execute、sweepToCold（到 cold）、topUp（到兄弟热金库）、人工放行的 execute。其他任何调用序列都不能让余额减少 |
| I2 | 裁决一旦写入，decision 不再改变；used 只能从 false 变 true |
| I3 | frozenUntil 只增不减 |
| I4 | 生效警戒等级下降只发生在：时间过了 expiresAt，或 executeLowerAlert（两人签名 + 排队期满）之后 |
| I5 | 冷钱包 delay 下降只发生在 executeLowerDelay 之后 |
| I6 | quota ≤ cap；quota 增加只发生在 refillQuota，且 epoch 严格递增、单次增加 ≤ r_max × (epoch − lastEpoch) |
| I7 | 不经 Forwarder、不经两人签名、不经 ConfigTimelock，没有任何地址能改 Receiver 的任何状态 |
| I8 | ThreatRegistry 的条目不能被删除或改成「非可疑」，只会到期 |

### 4.2 权限清单快照

- `verify/access_manifest.json` 列出每个合约每个非 view 外部函数，以及它的调用者限制（forwarder / self / receiver / timelock / officers / anyone）
- 检查脚本用 `forge inspect` 列出实际函数，与清单比对：**多出一个函数就失败**，必须先更新清单并在 STATUS 记一条，审查者确认后才能合并
- 这是防止「顺手加一个 owner 函数」的主要手段

### 4.3 确定性检查（DET）

- 对 trap、cosign、patrol 各准备固定的触发（测试网上的固定交易 hash；cron 用固定时间）
- `cre workflow simulate`（不加 --broadcast）跑两次，取日志里的报告字节
- 用 packages/shared 解码，逐字段比较（包括 issuedAt）；再对 sealedReason、SCORE 密文单独比较
- 已知限制：本地只能证明「同一节点跑两次一样」，不能证明不同节点一样；不同节点的差异主要来自读取的区块不同，所以另由 ST 检查「所有 EVM read 都显式指定区块号」

### 4.4 打包扫描（BUNDLE）

- 输入：`secrets/decoys.local.json` 里的全部诱饵地址、诱饵 userIdHash、诱饵 tag；所有 service key 与角色密码
- 扫描：apps/console 与 apps/user-app 的 `.next` 产物、exchange-api 源码与镜像、exchange_a / exchange_b 的数据库转储（只扫「诱饵标记」字段名与值，不扫诱饵本身的账户行，因为诱饵账户本来就该在里面）
- 任何命中即失败

### 4.5 场景脚本（E2E）的写法

- 每个脚本开头 `reset-demo`（或指定状态），结尾读链上状态逐项断言
- 输出 JSON：场景名、D 编号、每一步的交易 hash 与 Basescan 链接、断言结果、耗时
- 视频的每一段都必须有对应场景（37_phase7_video.md）

## 5. 一致性报告

- 命令：`pnpm verify:design [--phase N] [--env local|testnet|aws]`
- 实现：packages/verify 里有检查注册表，每个检查声明 D 编号、类型、阶段、执行方式
- 输出 `reports/design-conformance.md` 与 `.json`：
  - 每个 D 编号的状态（pass / fail / not-yet / waived）
  - 证据：测试名、交易链接、指标值与来源类型
- **waived 只能在 STATUS「设计变更」有对应记录时使用**，报告里显示那条记录
- CI（GitHub Actions）：每次 PR 跑 U、INV、ST、DB、BUNDLE；E2E 与 DET 需要测试网和 CRE 登录，阶段结束时手动跑
- 阶段完成标准里的「`verify:design --phase N` 全过」指：该阶段及之前阶段的 D 项都是 pass 或有记录的 waived；STATUS 标为「跳过」的阶段，其 D 项显示 not-yet，不算失败，但提交前要么完成、要么 waived

## 6. 独立审查（REV）

每个阶段结束，开一个新的 Claude Code 会话，不给它这个阶段的对话历史，只给：
- docs/proposal_v4.md
- 本文件
- 10_interfaces.md
- 本阶段的代码 diff
- 最新的 design-conformance 报告

提示模板：

> 你是这个项目的设计审查者。逐条检查本阶段相关的 D 编号：实现是否符合设计？指出具体文件与行号。另外找出：设计没写、但代码里多出来的行为（尤其是新的出金路径、新的权限、新的数据外流）。只报告问题，不修改代码。

审查结果写进 STATUS「审查记录」；High 问题修完才算阶段完成。

## 7. 提交前最终检查清单

- [ ] `pnpm verify:design --env testnet` 全部 pass 或有记录的 waived
- [ ] 最近一次 REV 没有未处理的 High
- [ ] 视频里每个数字都能在 metrics 或 STATUS 找到来源
- [ ] 视频里没有诱饵完整地址；SIM 模式有说明
- [ ] proposal_v4 与实现的差异都已回写（STATUS「设计变更」逐条处理）
- [ ] reports/design-conformance.md 放进仓库，README 链接到它
