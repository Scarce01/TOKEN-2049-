# 阶段 3：预防层最小版（第 11 到 17 小时）

## 目标

1. 正常用户签名提款全流程：App 签名 → 后台提交 → Cosign 判定 → 金库执行。
2. 下面这些攻击都挡住：
   - 伪造签名 → 关 3 拒绝
   - Bybit 类交易 → 关 2 拒绝
   - 抢先给新账户登记钥匙 → 关 5 转人工
   - 碰诱饵账户、或把钱付到诱饵地址 → 对外显示「处理中」，链上同时确认级收紧
3. 人员可以在 Console 看三栏对照，两人签名人工放行，一人否决。

关 6、关 7、SPRT 分数在阶段 5。

## 前提

阶段 2 完成，并已跑 `reset-demo`（阶段 2 的演示把热金库撤空、警戒升到 4）。

## 任务

### 3.1 合约

- QuorumReceiver：
  - VERDICT：按 txHash 只写一次；APPROVE 时累计 approved[userIdHash][token]
  - consumeVerdict 正式版
  - queueManual / executeManual、queueLowerAlert / executeLowerAlert（两人签名 + MANUAL_DELAY）
  - CANCEL_QUEUED（一人即可）
  - extendFreeze（两人签名，立即生效，只延长）
- KeyRegistry：requestKeyChange、cancelKeyChange、finalizeKeyChange；排队中的首次登记可被 CANCEL_QUEUED 否决
- ColdVault：queue、executeQueued、queueLowerDelay、executeLowerDelay
- forge 测试：
  - 同一 txHash 的 APPROVE 只能用一次；第二份 VERDICT 不覆盖（`VerdictDuplicate`）
  - 过期的 APPROVE 不能用；PENDING、REJECT 不能用
  - VaultTx 改一个字节，txHash 对不上，revert `NoVerdict`
  - 一人签名 manual 失败；同一人签两次失败；MANUAL_DELAY 前不能执行；一人 cancel 后不能执行
  - alert 4 且温金库冻结期间，manual 不能执行；冻结到期、alert 仍是 4 时，manual 可以执行（慢车道）
  - releaseExpired：过期未用的 APPROVE 扣回后，approvedOf 减少
  - approvedOf 在 APPROVE 写入后增加
  - 同一区块两份 APPROVE，合计超过 depositedOf：第二份被降级为 PENDING 51（`VerdictDowngraded`）

### 3.2 用户 App（apps/user-app）

| 页面 | 做什么 |
| --- | --- |
| Setup | 连接钱包（injected）；开发时可导入 `secrets/dev-users.local.json` 里的测试私钥；新用户在充值前先 register |
| Deposit | 先读 `keyOf(userIdHash)`，不是用户自己的钥匙就拒绝充值并提示；从 Faucet 领 qUSD；DepositVault.deposit |
| Withdraw | 填代币、地址、金额；**逐字段显示要签的内容**；签 EIP-712；POST 到 exchange-api |
| Status | 状态与案件编号；PENDING 只显示「Processing, case Q-XXXX-XXXX」 |

### 3.3 交易所后台的提款流程（apps/exchange-api）

| 路由 / 工作 | 做什么 |
| --- | --- |
| POST /withdrawals | 收用户意图 + 签名；查自己的余额账本（不够就拒，这是业务检查，不是安全判断）；建 withdrawals 行（uuid） |
| submit worker | 组 Request（含后台算的 txHash）；用提交私钥调用 RequestBoard.submit；状态 submitted |
| verdict worker | 订阅 Receiver 的 VerdictRecorded（websocket，不轮询；断线后用 verdictOf 补查 submitted 状态的单）；再读 verdictOf(txHash) 确认；APPROVE → 调用 QuorumVault.execute；REJECT → rejected；PENDING → pending + 案件编号 |
| resubmit worker | 每分钟找 submitted 超过 RESUBMIT_AFTER 仍没有裁决的单，以及收到 ScoreConflict 的单，带完整内容调 RequestBoard.resubmit |
| 每个用户一次一笔 | 同一个 userIdHash 同时只送一笔请求，前一笔有裁决才送下一笔（并发会造成 ScoreConflict，阶段 5 起）。这是诚实后台的做法，合约不强制 |
| 排队 | outbox + pg-boss：POST /withdrawals 在同一个数据库交易里写 withdrawals 行与一条任务；submit、execute 都是 pg-boss 任务，幂等键 = requestId，失败指数退避；pg-boss 连直连或 session 模式。崩溃重启不丢单、不重复提交（RequestBoard 对重复 requestId 会 revert，当成已提交处理） |
| execute 失败 | `QuotaExceeded` → manual（等人员）；`Frozen`、`AlertConfirmed` → pending |
| GET /withdrawals/:id | 给 App 查状态 |
| POST /admin/withdrawals | 管理员直接建提款（任意用户、任意地址、自带签名）。攻击者会用的入口，故意保留 |
| POST /admin/register-key | 管理员替任意 userIdHash 提交 KeyRegistry.register。攻击者会用的入口，故意保留 |

后台只转发、不判断；Cosign 说什么就是什么。

### 3.4 Cosign workflow（workflows/cosign）

1. 只有一个 handler：RequestBoard 的 WithdrawalRequested，confidence **LATEST**（10_interfaces.md 第 9 节）。不再拆 decoy-fast 与 main：log trigger 的限流按 workflow 计，两个 handler 订同一个事件会让每个请求占两份额度；SAFE 在 Base 上每笔多等几分钟，而裁决的安全性来自用户签名，不来自区块确认（42_performance.md 第 2 节）
2. 读取：`headerByNumber`（事件所在区块，取区块时间）+ `QuorumLens.cosignView` 一次，全部指定事件所在区块号。EVM client 没有 getCode，不做「收款地址是不是合约」的判断。
3. 读 secrets：QUORUM_K、DECOY_TAGS。
4. **先做诱饵检查，再跑各关。** 攻击者伪造诱饵账户的提款时，手上没有那个账户的钥匙，关 3 一定会拒；先跑关 3 的话，陷阱永远不会触发。
   - 账户 tag 命中 → PENDING，原因 41，附确认级动作包（suspect = 请求里的收款地址），写报告结束
   - 收款地址 tag 命中 → PENDING，原因 43，附确认级动作包（suspect = 0），写报告结束
   - 报告幂等：同一事件被处理两次，VERDICT 只写一次、确认级动作可重复
5. 依序检查，第一个不过就停：
   - 关 1：用请求字段按第 1 节公式重算 txHash，等于请求里的 txHash；否则 REJECT 11
   - 关 2：
     - kind 1 → REJECT 21
     - vault 不属于这个 orgId（config 的 orgVaults）→ REJECT 23
     - 代币不在 config 的允许清单 → REJECT 22
   - 关 3：
     - keyOf ≠ 0 且等于事件里的 signer；否则 REJECT 31
     - 意图的 orgId、userIdHash、vault、token、to、amount、nonce、deadline 都等于请求；否则 REJECT 32
     - deadline ≥ 事件区块时间；否则 REJECT 33
   - 关 4：收款地址在共享名单 → PENDING 42
   - 关 5（最小版，按代币，不换算美元，bigint）：approved + amount ≤ deposited；否则 PENDING 51。**合约在写入 APPROVE 时会再检查一次**（同一区块多笔请求时 Cosign 读到的 approved 是旧值），超过就降级为 PENDING 51
   - 关 6、关 7：阶段 5
6. 组 VERDICT（含 token、amount、notBefore = 0）：
   - APPROVE 的 expiresAt = 事件区块时间 + VERDICT_TTL
   - PENDING 的 expiresAt = 0
   - sealedReason 用 `seal`（确定性 ECIES，每位人员一份），补齐到固定长度。S4 不通过时改存明文，Console 标「unsealed (demo)」
   - 所有写上链的时间都用事件区块时间，不用 runtime.now()
7. writeReport；检查两个状态字段。

验收（模拟）：对 3.6 每个红队命令产生的交易跑 `simulate --evm-tx-hash`，结果都符合预期；同一笔模拟两次，第二次的 VERDICT 被忽略。

### 3.5 Console：Cases 页与人员操作

| 区块 | 内容 | 数据 |
| --- | --- | --- |
| 案件列表 | 编号、类型、决定、时间 | ponder_quorum.cases（经服务端路由） |
| 三栏对照 | Backend says（请求字段）/ User signed（意图 + signer）/ Chain facts（KeyRegistry 钥匙、充值、已批准、名单状态）；不一致的字段标红 | 事件 + viem 在该区块读 |
| 关卡结果 | 解开的 sealedReason | 人员在浏览器导入自己的加密私钥（只放内存，不上传、不存 localStorage） |
| 人员操作 | Approve（manual）、Extend freeze、Lower alert、Cancel（否决排队中的操作或钥匙登记） | 钱包签 OfficerAction → 存 officer_signatures → 满两人后任一人员提交；Cancel 一人即可提交 |
| 排队中 | 人工放行、降级、有充值账户的首次钥匙登记、配置变更，各自的倒数 | 链上事件 |

### 3.6 红队命令新增

| 命令 | 做什么 | 预期 |
| --- | --- | --- |
| `forge --victim <user>` | 用 admin 路由给真实用户建提款，收款地址是攻击者，签名用攻击者自己的钥匙 | REJECT 31；钱不动 |
| `forge-decoy` | 挑余额最大的几个账户伪造提款（其中有诱饵） | 后台只看到 PENDING；链上确认级收紧；攻击者地址进名单 |
| `pay-decoy-addr` | 用白名单里的诱饵地址当收款地址提交提款 | PENDING 43；确认级收紧 |
| `register-hijack --user <有充值的>` | 用 admin 路由替有充值的用户登记攻击者钥匙 | 进入排队；人员 Cancel 后作废 |
| `register-hijack --new` | 替新建、没充值的账户登记攻击者钥匙，再提款 | 关 5 → PENDING 51；钱不动 |
| `register-hijack --new --self-fund` | 同上，但攻击者自己充值 D 再提 D + 1 | 关 5 → PENDING 51；最多只能取回自己的 D |
| `same-block --n 3` | 对同一个劫持账户在同一区块提交 3 笔、各等于全部充值 | 最多 1 笔 APPROVE，其余被合约降级为 PENDING 51 |
| `stop-cre` | 停掉 sim-runner（方式 B）或 pause workflow（方式 A），提交一笔正常提款 | 没有裁决、钱不动；两人签名的人工放行仍可完成（D27） |
| `grief-deposit` | 给别人的 userIdHash 充 1 wei | 低于 MIN_DEPOSIT，不影响对方首次登记 |
| `bybit` | 提交 kind 1、operation = 1 的交易 | REJECT 21 |
| `replay` | 同一 requestId 或同一意图 nonce 再提交 | RequestBoard revert |
| `execute-pending` | 对 PENDING 的请求直接调用 execute | revert `NoVerdict` |

### 3.7 正常流量与误报

- `scripts/load-normal`：用 20 个活跃种子用户签 50 笔正常提款，**每秒最多 1 笔**（Cosign 这个 workflow 每 6 秒最多 10 个 log 事件）
- `scripts/load-normal --rate 1.0 --minutes 10`（D56、D60、D62）：先跑 `reset-demo`；每笔 1 qUSD（约 600 qUSD，低于热金库初始额度 5,000）；只挑 depositedOf − approvedOf ≥ 计划金额的用户，不够先补充值；exchange-api 的提交私钥用单一的 nonce 管理（pg-boss 工作并发，但发交易串行）；A 的额度桶每秒约 0.83 个，多出来的被 RequestBoard 拒绝后退避重试，这正是要测的；记录每笔的 lat_*、Cosign 排队延迟、请求数与裁决数；结束后统计 ponder_quorum 与 exchange_a 新增的行数与大小，推算每天的量。方式 B 下 sim-runner 跟不上 1.5 笔 / 秒：先测 sim-runner 的实际上限，再用这个速率跑，并在 STATUS 记一条
- 每笔金额不超过热金库 quota 剩余量
- 预期：50 个请求都有 VERDICT（请求数 = 裁决数，没有丢事件），全部 APPROVE 并执行；记录 `request_to_verdict_seconds`（testnet_measured）
- 有任何一笔 PENDING、REJECT 或缺裁决，都要查原因写进 STATUS.md

## 设计一致性（必须通过）

D04、D06（付款到诱饵地址部分）、D09（两人延长部分）、D14.1 到 D14.5、D15（关 4、5 部分）、D16、D27（停掉 CRE 后的慢车道）、D30（cosign）、D34、D35、D41、D56、D57（Cosign 部分）、D60、D62（合约与 E2E 部分）、D63

场景脚本：`scenes/s3_forge.sh`、`scenes/s6_bybit.sh`（构造版）在本阶段写好。

## 阶段 3 完成标准

- [ ] 正常提款端到端通过：50 笔请求 = 50 份裁决，全部执行；有 request_to_verdict_seconds 实测
- [ ] 3.6 每个红队命令都得到预期结果
- [ ] Console 三栏对照能看出伪造的字段；两人签名 manual 放行走得完；一人 Cancel 有效
- [ ] exchange-api 里没有任何判断逻辑（code review 检查）
- [ ] `pnpm verify:design --phase 3` 全过；REV 没有未处理的 High
- [ ] STATUS.md 更新
