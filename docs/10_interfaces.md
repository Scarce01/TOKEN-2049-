# 10 接口：ID、签名、合约、报告、事件

开赛前两小时全队先对齐这份文件，之后各写各的。要改接口，先改这里，再改代码，并在 docs/STATUS.md 记一笔。

## 1. ID 与哈希

| 名称 | 类型 | 怎么算 | 谁算 |
| --- | --- | --- | --- |
| orgId | bytes32 | keccak256("exchange-a")、keccak256("exchange-b") | 常量 |
| userIdHash | bytes32 | keccak256(abi.encode(orgSalt, userId))；orgSalt 存在交易所自己的配置 | exchange-api |
| requestId | bytes32 | keccak256(abi.encode(orgId, withdrawals.uuid))；**用 uuid，不用自增 id**（`db reset` 后自增 id 会重复） | exchange-api |
| txHash | bytes32 | keccak256(abi.encode(chainId, vault, requestId, userIdHash, token, to, amount, nonce, deadline))。**包含 requestId 和 userIdHash**，所以每个请求的 txHash 唯一，后台不能用别的请求抢先占用同一个 txHash | exchange-api 算；QuorumVault 执行时自己重算 |
| caseId（提款） | bytes32 | keccak256(abi.encode(orgId, requestId)) | Cosign |
| caseId（陷阱） | bytes32 | keccak256(abi.encode(orgId, chainId, txHash, logIndex))；原生币诱饵用 (orgId, chainId, 诱饵地址, 发现时的区块号) | Trap / Patrol |
| 显示用案件编号 | string | "Q-" + caseId 前 4 个 hex 大写 + "-" + 接下来 4 个 | Console、exchange-api |
| evidenceHash | bytes32 | keccak256(abi.encode(chainId, txHash, logIndex)) | Trap |
| fingerprintHash | bytes32 | keccak256(abi.encode(chainId, 代币, 金额区间编号, 动作类型))。**不含地址**：它描述的是「手法」（例如贴着假门槛的金额、测试转账），换了新地址也认得出；地址另由 suspect 字段匹配 | Trap、Cosign |
| 诱饵 tag | bytes8 | HMAC-SHA256(K, 类型 ‖ 标识) 取前 8 字节；类型 "acct" 对应 userIdHash，"addr" 对应诱饵收款地址。S4 不通过时改为 keccak256(salt ‖ 标识)（viem），salt 放 secret | decoy-admin 预先算好放 secret；Cosign 现场算并比对 |

`native` 代币用 address(0) 表示。金额一律最小单位整数。

## 2. EIP-712

**用户意图**（user-app 签，RequestBoard 恢复签名人）

- domain：name "Quorum"，version "1"，chainId，verifyingContract = RequestBoard
- 类型 `Withdrawal(bytes32 orgId, bytes32 userIdHash, address vault, address token, address to, uint256 amount, uint256 nonce, uint64 deadline)`
- nonce：每个用户递增；RequestBoard 用**意图里的** nonce 标记已用

**钥匙登记**（KeyRegistry 验）

- domain：name "QuorumKeys"，version "1"，chainId，verifyingContract = KeyRegistry
- 类型 `KeyBinding(bytes32 userIdHash, address key, uint8 action, uint256 nonce, uint64 deadline)`；action：1 register、2 requestChange（由新钥匙签）、3 cancelChange（由旧钥匙签）

**人员操作**（console 收集两位人员签名，QuorumReceiver / ColdVault / ConfigTimelock 验）

- domain：name "QuorumOfficer"，version "1"，chainId，verifyingContract = 目标合约
- 类型 `OfficerAction(uint8 kind, bytes32 subject, uint256 value, uint256 nonce, uint64 deadline)`

| kind | 名称 | subject | value | 签名人数 |
| --- | --- | --- | --- | --- |
| 1 | EXTEND_FREEZE | bytes32(vault) | 新的 until | 2 |
| 2 | MANUAL_APPROVE | txHash | 0 | 2 |
| 3 | LOWER_ALERT | orgId | 新等级 | 2，排队 MANUAL_DELAY |
| 4 | COLD_QUEUE | keccak256(abi.encode(token, to, amount)) | 0 | 2 |
| 5 | COLD_LOWER_DELAY | bytes32(coldVault) | 新 delay | 2，排队 |
| 6 | CANCEL_QUEUED | 被取消的队列 id | 0 | **1 位即可**（任何一位人员都能否决排队中的人工放行、降级、钥匙登记、配置变更） |
| 7 | CONFIG | keccak256(abi.encode(target, selector, args)) | 0 | 2，排队 CONFIG_DELAY |
| 9 | RESET_ASSET_CHECKPOINT | keccak256(abi.encode(orgId, token)) | 新的 assetValue | 2，排队 MANUAL_DELAY；查明资产守恒报警的原因（例如误报）后，让对账从新值重新开始 |
| 8 | PLANNED_OP | keccak256(abi.encode(vault, token, windowStart, windowEnd)) | 每分钟上限金额 | 2，立即生效；窗口最长 PLANNED_OP_MAX_WINDOW（24 小时）；合约记下登记时的分钟 registeredMinute，按 windowStart 所在小时分桶保存，Lens 只扫重算区间涉及的桶（含已过期的条目）。计划内的大额**流出**（例如批量出金给合作方）事先报备，Patrol 的 CUSUM 在 max(windowStart, registeredMinute) 到 windowEnd 之间，每分钟的 x_t 扣掉这个上限（扣到 0 为止）。按分钟扣、不记累计用量，重算时结果才不会因为检查点而变；**不影响诱饵检测，也不放宽任何裁决** |

每个人员 nonce 递增；同一人签两次不算两人。

## 3. 合约

所有合约不可升级、没有 delegatecall、没有任意 call。

**部署后不能改的（immutable）：** Receiver 的 forwarder、mode（PROD / SIM）、simOperator；金库的 receiver、cold 地址；ColdVault 的 receiver。

**能改的配置一律走 ConfigTimelock（阶段 1 就做最小版）：** 两位人员签名排队，CONFIG_DELAY 后生效，期间发事件、Console 显示，任何一位人员可取消。管的内容：人员名单、workflow owner / name 白名单、金库登记、代币清单、cap。**没有任何 owner 函数能直接改这些，也没有「重设 quota」函数**（初始 quota 只在构造时设一次）。部署私钥由安全负责人持有，不是 exchange-api 的提交私钥；部署完成后部署私钥对任何合约都没有权限。

### 3.1 RequestBoard

| 函数 | 调用者 | 输入 | 做什么 | 事件 / revert |
| --- | --- | --- | --- | --- |
| submit | 已登记的交易所提交地址 | Request {requestId, orgId, userIdHash, kind, vault, token, to, amount, nonce, deadline, txHash（后台自己算的）, safeTx}；Intent（EIP-712 字段）；userSig | 检查提交地址属于 orgId；**这个 org 的提交额度桶还有余量**（见下）；requestId 没用过；恢复签名人 signer；把 (intent.userIdHash, intent.nonce) 标记已用（已用则 revert）；存 txHashOf[requestId]、signerOf[requestId]、submittedAt[requestId]，以及 contentHash[requestId] = keccak256(request, intent, userSig)（只存一个 slot，不存完整内容）；该 org 的请求分钟桶 reqRing（32 格，格式同 outRing）在提交的那一分钟加 1。**不判断签名人对不对、字段一不一致**，那是 Cosign 的事 | `WithdrawalRequested(requestId indexed, orgId indexed, userIdHash indexed, request, intent, signer)`；`SubmitRateLimited` |
| resubmit(request, intent, userSig) | 该 org 的提交地址 | 完整的请求、意图、签名（calldata） | keccak256 等于存下的 contentHash；距上次提交或重发已超过 RESUBMIT_AFTER；同样占额度桶。重发同一个事件（requestId、txHash 不变）。**不查有没有裁决**（RequestBoard 不依赖 Receiver，reset-demo 换 Receiver 也不受影响）：已有裁决时 Cosign 重判一次，VERDICT 只写一次（VerdictDuplicate），浪费的是这家后台自己的额度 | 同上 |

**提交额度桶（防止不可信后台用垃圾请求淹没 Cosign）：** CRE 的 log trigger 每个 workflow 每 6 秒最多 10 个事件，两家交易所共用同一个 Cosign。所以 RequestBoard 在链上替每个 org 分配一份：token bucket，容量与补充速度构造时设（A：容量 5、每 1.2 秒补 1；B：容量 4、每 1.5 秒补 1；合计每秒 1.5 个、容量 9，低于 CRE 的每 6 秒 10 个）。超过就 revert `SubmitRateLimited`，exchange-api 退避重试。一家交易所的后台被攻陷，最多占满自己那一份，挤不掉另一家，也挤不掉 Trap（Trap 是另一个 workflow，有自己的额度）。

**事件被丢或报告被拒怎么办：** 每个请求最终都必须有裁决。超过 RESUBMIT_AFTER 还没有裁决（或看到 ScoreConflict），exchange-api 调 resubmit。Receiver 第一次写入某个请求的裁决时，按这个请求的 submittedAt 所在分钟，在该 org 的裁决分钟桶 verdictRing 加 1；写入时那一格的 minute 比这个请求的分钟新（格子已被重用），就不写，避免把新的计数冲掉。Patrol 每分钟比对两个桶：提交时间早于 BACKLOG_AGE（15 分钟，够重发两次以上）的那些分钟里，请求数 − 裁决数的合计超过 BACKLOG_MAX，就当作「不干净」（不补额度、不 TOPUP），并把该 org 升到 L1，期限 BACKLOG_ALERT_TTL（收紧，用锚点区块）。只比对 Receiver 部署分钟（`deployedMinute`）之后的分钟，reset-demo 换了 Receiver 也不会误报。按提交分钟对齐，新请求的裁决就不会掩盖旧请求的缺漏；还在正常处理中的请求也不会被算进去。

**正常用户不会触发积压：** 同一用户的并发请求才会 ScoreConflict（kind 9），exchange-api 对每个 userIdHash 同时只送一笔，看到 ScoreConflict 就在 RESUBMIT_AFTER（2 分钟）到期时重发。被攻陷的后台当然可以故意制造积压，结果只是让自己这家进 L1，伤不到另一家，也放不出钱。CRE 超出限流时是丢弃还是排队，文档没写，阶段 1 的 spike S10 实测。

提交地址的登记走 ConfigTimelock。kind：0 = 金库转账；1 = Safe 交易（safeTx = {to, value, data, operation}），**Cosign 对 kind 1 一律 REJECT**（金库不支持），只用来演示 Bybit 类交易被关 2 拦下。

### 3.2 QuorumReceiver

| 函数 | 调用者 | 做什么 |
| --- | --- | --- |
| onReport(bytes metadata, bytes report) | Forwarder | 见下方检查顺序 |
| supportsInterface | 任何 | IReceiver + ERC165 |
| applyAction(kind, data) | **只有合约自己**（onlySelf） | 给 try/catch 用的外部自调用入口 |
| consumeVerdict(txHash) | 已登记的金库 | 裁决是 APPROVE、没过期、没用过 → 标记已用，返回 (manual, userIdHash) |
| verdictOf(txHash)、approvedOf(userIdHash, token)、isFrozen(vault)、alert()、lastPing() | 任何 | 只读；approvedOf 给关 5 用 = 已执行 + 未过期未使用的 APPROVE |
| releaseExpired(txHash) | 任何人 | APPROVE 过期且没用过：从 approved 里扣回，避免过期的批准永久占用额度 |
| extendFreeze(sigs) | 任何人提交 + 2 位人员签名 | 立即生效，只能延长 |
| queueManual / executeManual | 任何人提交 + 2 位人员签名 | 排队 MANUAL_DELAY 后生效，产生 manual = true 的 APPROVE；可被 CANCEL_QUEUED 否决 |
| queueLowerAlert / executeLowerAlert | 同上 | 降警戒等级 |

**onReport 检查顺序：**

1. `msg.sender == forwarder`
2. 模式检查：
   - PROD：从 metadata 解出 workflowName、workflowOwner（metadata 是 `abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner)`，长度可能是 62 或 64，**不要要求等于 62**）。检查 owner 等于白名单 owner，workflowName 在白名单里。**白名单存的是 metadata 里编码后的 bytes10**（文档说明：sha256(name) 的前 10 个 hex 字符，再按 ASCII 编码），不是 `bytes10("trap")`；packages/shared 提供 `encodeWorkflowName`，S2 / S8 要把实际收到的值记进 STATUS.md 核对。**不检查 workflowId**：workflow 的代码或配置一变（例如换诱饵清单），ID 就会变
   - SIM（只在没有部署权限时用）：metadata 为空；要求 `tx.origin == simOperator`。SIM 模式只用于演示，视频要说明；SIM 模式下无法区分是哪个 workflow，所以 kind 白名单按「全部允许」处理，这是 SIM 的已知弱点
3. **kind 白名单（PROD）：** 每个 workflowName 只能发规定的 kind

   | workflow | 允许的 kind |
   | --- | --- |
   | trap | FREEZE、QUOTA_ZERO、SWEEP、ALERT、COLD_DELAY、THREAT |
   | cosign | VERDICT、SCORE，以及确认级那六个 |
   | patrol | PING、QUOTA_REFILL、TOPUP、THRESHOLD_COMMIT、THRESHOLD_REVEAL、PATROL_STATE、ASSET_CHECKPOINT、THREAT（derived），以及确认级那六个 |

4. 解码信封；`chainId == block.chainid`。`issuedAt` 超过 `REPORT_MAX_AGE` 的报告：**收紧类 action（ALERT、FREEZE、SWEEP、QUOTA_ZERO、COLD_DELAY、THREAT）照常执行**，放宽或写状态的 action（VERDICT、QUOTA_REFILL、TOPUP、SCORE、THRESHOLD_*、PATROL_STATE、ASSET_CHECKPOINT）跳过并发 `ActionStale`。原因：issuedAt 取事件区块时间，CRE 排队久了 Trap 的报告也会「变旧」，不能因此不冻结；放宽类本来就有 epoch、expiresAt、检查点等自己的时效检查
5. 按顺序对每个 action 做 `try this.applyAction(kind, data)`；失败发 `ActionFailed` 继续下一个，避免一个动作失败把冻结也挡掉
6. 发 `ReportProcessed(caseId, kinds)`

**每个 action 都必须幂等**，因为同一个事件可能被模拟多次（sim-runner 重试、`--listen` 和补抓同时触发），而 issuedAt 每次不同，按报告字节去重没有用：

| action | 幂等规则 |
| --- | --- |
| VERDICT | 按 txHash **只写一次**；已有裁决（不论是否已用）就忽略，发 `VerdictDuplicate` |
| FREEZE | until 取较晚者 |
| QUOTA_ZERO、SWEEP | 本来就幂等 |
| ALERT | 棘轮（见下） |
| COLD_DELAY | 只升不降，相同值不变 |
| THREAT | 按 evidenceHash 去重；同一 evidenceHash 第二次写入不增加 count |
| QUOTA_REFILL | epoch 必须 > lastEpoch |
| TOPUP | 补到目标值，重复执行无效果 |
| SCORE | 按 (scoreKey, requestId) 去重 |
| THRESHOLD_* | 按 (epoch, token) 只写一次 |
| PATROL_STATE | minute 必须大于现有检查点 |
| ASSET_CHECKPOINT | safeBlock 必须大于现有值；assetValue 是高水位（不得变小，例外见第 4 节 kind 14） |

**警戒棘轮：** 等级 0 正常、1 到 3 对应 L1 到 L3、4 = CONFIRMED（确认级）。新等级 > 当前生效等级，或当前已过期，就写入；**等级相同时只延长 expiresAt**。降级只能到期，或 LOWER_ALERT（两人签名 + 排队）。

### 3.3 QuorumVault（热、温各部署一个）

`VaultTx = {requestId, userIdHash, token, to, amount, nonce, deadline}`

| 函数 | 调用者 | 做什么 | 事件 / revert |
| --- | --- | --- | --- |
| execute(VaultTx tx) | 任何人（通常 exchange-api） | 1. 自己重算 txHash（第 1 节公式，vault = 自己）；(userIdHash, nonce) 没有付过款，付款后标记（同一份签名不会因为换了 requestId 而付两次）。2. 没被冻结。3. 代币在允许清单。4. `receiver.consumeVerdict(txHash)`，并检查 now ≥ notBefore。5. 不是 manual：`receiver.alert()` < 4，且 `quota[token] ≥ amount`，扣减。6. 转账。**确认级期间快车道全停；人工放行（慢车道）仍可用，只要金库没被冻结**：温金库冻结到期且没被延长后，人员可以两人签名 + 排队放行，这符合 proposal 第 5 节「冻结有期限」 | `Executed(txHash, token, to, amount, manual)`；`Frozen`、`TokenNotAllowed`、`NoVerdict`、`AlertConfirmed`（非 manual 时）、`QuotaExceeded` |
| sweepToCold(tokens) | 只有 Receiver | 把这些代币余额转到 cold；R7 车道开启时留下 `reserve[token]`（车道关闭时 reserve 必为 0，即全部转走） | `Swept` |
| zeroQuota(tokens) | 只有 Receiver | quota 清零 | `QuotaZeroed` |
| refillQuota(token, epoch, amount) | 只有 Receiver（阶段 6） | 规则见第 4 节 QUOTA_REFILL | `QuotaRefilled` |
| topUp(token, targetBalance) | 只有 Receiver，只在温金库上 | 规则见第 4 节 TOPUP | `TopUp` |
| configHash() | 任何 | 关键配置（receiver、cold、代币清单、cap、r_max）的 hash，给 Patrol 查配置漂移 | |
| fund(token, amount) | 任何人（交易所注资、ColdVault 放款） | transferFrom 拉钱进来，fundedTotal[token] += amount。交易所与冷钱包的正常注资都走这里；直接 transfer 进金库的钱不记账（对账见 36_phase6.md 6.1） | `Funded` |
| outStats(token) | 任何（view） | 返回 (outCount, extOutTotal, fundedTotal)：累计**对外**转出的笔数与总额，以及经 fund() 记账的流入。execute 与 sweepToCold 会加 extOutTotal；topUp（温金库转给兄弟热金库）是内部转账，都不加。只增不减 | |
| outRing(token) | 任何（view） | 只在热金库上。返回最近 32 分钟的分钟桶，每格一个 word：高 32 位 minute、低 224 位 amount，minute = floor(区块时间 / 60)。只有 execute（含 manual）写入：同一分钟累加，换分钟时覆盖 `minute % 32` 那格。给 CUSUM 用（36_phase6.md 6.3） | |

cap 和初始 quota 在构造时设；cap 之后只能走 ConfigTimelock。额度不够时 revert `QuotaExceeded`，exchange-api 把这笔转到人工复核（慢车道），人员 manual 放行后不扣额度。

### 3.4 ColdVault

| 函数 | 调用者 | 做什么 |
| --- | --- | --- |
| queue(token, to, amount, sigs) | 任何人提交 + 2 位人员（COLD_QUEUE） | 排队，readyAt = now + delay |
| executeQueued(id) | 任何人 | 到时间才转；确认级期间也能执行（冷钱包是最后的人工通道）。目的地是登记过的我方金库时，approve 后调用 `vault.fund()`，不直接 transfer（资产守恒要记到这笔流入） |
| raiseDelay(newDelay) | 只有 Receiver | 只升，≤ MAX_COLD_DELAY |
| queueLowerDelay / executeLowerDelay | 2 位人员（COLD_LOWER_DELAY） | 排队后才生效 |

阶段 1 只做 receive + raiseDelay；queue 系列放阶段 3。

### 3.5 KeyRegistry

| 函数 | 调用者 | 做什么 |
| --- | --- | --- |
| register(userIdHash, key, sig) / registerBatch | 任何人提交，sig 由 key 签（KeyBinding action 1） | 这个 userIdHash 还没有钥匙：如果 `DepositVault.hasDeposit(userIdHash)` 为假，直接生效；**已经有充值的账户，首次登记也要等 KEY_CHANGE_DELAY**，期间 Console 显示，任何一位人员可以用 CANCEL_QUEUED 否决 |
| requestKeyChange(userIdHash, newKey, sig) | sig 由新钥匙签（action 2） | 进入 KEY_CHANGE_DELAY |
| cancelKeyChange(userIdHash, sig) | sig 由旧钥匙签（action 3） | 取消 |
| finalizeKeyChange(userIdHash) | 任何人 | 期满生效 |
| keyOf(userIdHash) | 任何 | 当前生效的钥匙 |

已知弱点：从没充过值、也没登记过钥匙的新账户，第一次登记仍然信任交易所开户流程。缓解：

- 关 5 用倍数 1.0：后台抢先登记后，最多只能取走它自己充进去的钱，没有利润
- user-app 每次充值前先读 `keyOf`，不是用户自己的钥匙就拒绝充值并提示，避免用户把钱充进被劫持的账户
- 用 1 wei 骚扰别人首次登记的成本由 MIN_DEPOSIT 抬高；被骚扰的结果只是等待，不会丢钱

### 3.6 DepositVault

| 函数 | 调用者 | 做什么 | 事件 |
| --- | --- | --- | --- |
| deposit(userIdHash, token, amount) | 任何人 | 收钱，累计到 deposited[userIdHash][token]，记录 firstDepositAt，再转到交易所收款地址（构造时写死，不是金库；金库由交易所另行注资） | `Deposited` |
| depositBatch(...) | 任何人 | 种子数据用 | `Deposited` × n |
| depositedOf(userIdHash, token) | 任何 | 只读 | |
| firstDepositAt(userIdHash) | 任何 | 阶段 1 就实现（reset-demo 不重新部署 DepositVault） | |
| hasDeposit(userIdHash) | 任何 | 任一代币累计充值 ≥ MIN_DEPOSIT 才算（防止有人充 1 wei 把别人的首次登记拖进排队） | |

### 3.7 ThreatRegistry（全网一个，阶段 2 才做）

| 函数 | 调用者 | 做什么 |
| --- | --- | --- |
| add(entry) | 已登记的 Receiver | 记录 {suspect, chainId, evidenceHash, fingerprintHash, reporterOrg, firstSeen, expiresAt, count, derived}；按 evidenceHash 去重；同一地址不同证据累加 count、expiresAt 取较晚；**拒绝 address(0) 和已登记的我方合约地址**；阶段 5 起要求附 Merkle 证明 |
| isSuspect(addr)、entryOf(addr)、fingerprintActive(fp) | 任何 | 只看有效期内的条目 |

Receiver 的登记走 ConfigTimelock。

### 3.8 ConfigTimelock（阶段 1 最小版）

queue(target, selector, args, sigs) → 等 CONFIG_DELAY → execute；任何一位人员可 cancel。目标合约的配置函数只接受 ConfigTimelock 调用。部署脚本在构造时写好初始配置，之后所有改动都走这里。

### 3.9 测试代币与价格

- MockERC20：qUSD（6 位小数）、qETH（18 位）。只有 faucet 合约能 mint，faucet 每个地址每小时有上限
- MockV3Aggregator：Base Sepolia 上找不到 ETH/USD feed 时用它代替，不换链（只影响阶段 5 的关 5 美元换算）

## 4. 报告格式

**信封**：`abi.encode(uint8 version, uint256 chainId, bytes32 orgId, bytes32 caseId, uint64 issuedAt, Action[] actions)`，`Action = (uint8 kind, bytes data)`。version = 1。issuedAt 用触发区块的区块头时间（cron 用锚点区块 latest − ANCHOR_LAG 的区块头），不用 `runtime.now()`（CLAUDE.md 规则 5）。

| kind | 名称 | data 的 ABI | 效果 | 阶段 |
| --- | --- | --- | --- | --- |
| 0 | PING | (bytes32 note) | 写 lastPing，只用于验证链路 | 1 |
| 1 | VERDICT | (bytes32 requestId, bytes32 txHash, bytes32 userIdHash, address token, uint256 amount, uint8 decision, uint8 publicReason, uint64 notBefore, uint64 expiresAt, bytes sealedReason) | 存裁决（只写一次；同一份报告的 SCORE 冲突时跳过，见 kind 9）。合约降级（PENDING 31、51）的裁决会发 `VerdictDowngraded`，这是 D15「各种 PENDING 不可区分」的已知例外，sealedReason 仍是 Cosign 写的原因，Console 以合约降级为准。**先检查 RequestBoard.txHashOf(requestId) == txHash**，对不上（例如请求被重组掉了）就忽略，发 `VerdictOrphaned`，不占用这个 txHash。APPROVE 时**合约自己再检查两件事**：RequestBoard.signerOf(requestId) 等于 KeyRegistry.keyOf(userIdHash)，否则改存 PENDING 31；approved + amount ≤ depositedOf；超过就把这份裁决改存为 PENDING 51 并发 `VerdictDowngraded`（同一区块多笔请求时，Cosign 读到的 approved 是旧值，只靠 Cosign 会被绕过）；通过才 approved += amount。不论哪种决定，第一次写入时更新 verdictRing（3.1）。notBefore：L1 账户的延迟放行，0 表示立即。PENDING 的 expiresAt 一律为 0，sealedReason 一律补齐到固定长度 | 3 |
| 2 | ALERT | (uint8 level, uint64 expiresAt) | 警戒棘轮 | 1 |
| 3 | FREEZE | (address vault, uint64 until) | 冻结到 until，只延长 | 1 |
| 4 | SWEEP | (address vault, address[] tokens) | vault.sweepToCold | 2 |
| 5 | QUOTA_ZERO | (address vault, address[] tokens) | vault.zeroQuota | 2 |
| 6 | COLD_DELAY | (uint64 newDelay) | cold.raiseDelay | 2 |
| 7 | THREAT | (address suspect, uint64 chainId, bytes32 evidenceHash, bytes32 fingerprintHash, uint64 expiresAt, bytes32 parentEvidence, bytes proof) | 写 ThreatRegistry。suspect 为 0 时安静跳过，发 `ThreatSkipped`，**不发 ActionFailed**。parentEvidence ≠ 0 表示溯源得到的衍生条目：不需要 Merkle 证明，但父条目必须仍有效。proof 阶段 5 前为空 | 2 |
| 8 | QUOTA_REFILL | (address vault, address token, uint64 epoch, uint256 amount) | 补额度。合约规则：epoch > lastEpoch 且 epoch ≤ block.timestamp / QUOTA_PERIOD；amount ≤ r_max × (epoch − lastEpoch)；结果不超过 cap；**alert = 4 或金库冻结时直接拒绝**（链上兜底，不依赖 workflow 读到的数据新不新） | 6 |
| 9 | SCORE | (bytes32 scoreKey, bytes32 requestId, bytes32 prevHash, bytes ciphertext) | 存加密的账户分数。**只有通过关 1 到 3（用户签名有效）的请求才读写分数**；REJECT 不带 SCORE，否则后台可以伪造一笔签名错误的请求，替任何用户加分、把他推到 L2。检查顺序：先按 (scoreKey, requestId) 去重（已写过就安静忽略，不算冲突，同一事件重跑不会误报）；再比较 prevHash 是否等于现存密文的 keccak256（比较后交换）。对不上表示同一用户的另一笔请求先写了分数：Receiver 跳过同一份报告里的 VERDICT，发 `ScoreConflict(requestId)`；这个请求没有裁决，exchange-api 重发后用新分数重新判定。**报告里 SCORE 必须排在 VERDICT 前面**，Receiver 在同一次 onReport 里记住冲突，处理 VERDICT 时跳过（两种顺序都有单元测试。VERDICT 排在 SCORE 前面时，只把这两个 action 记为 ActionFailed 跳过，同一份报告里的收紧动作照常执行，符合 3.2 第 5 步「一个动作失败不能挡掉冻结」） | 5 |
| 10 | TOPUP | (address fromVault, address toVault, address token, uint256 targetBalance) | 把热金库补到 targetBalance：转 min(target − 热金库余额, 温金库余额)；已达标就什么都不做，所以天然幂等。目的地必须是构造时写死的兄弟金库；alert = 4 或任一金库冻结时合约直接拒绝 | 6 |
| 11 | THRESHOLD_COMMIT | (uint64 epoch, address token, bytes32 commitment) | 本期隐藏门槛的承诺（每种代币一份）；同一 (epoch, token) 只写一次 | 5 |
| 12 | THRESHOLD_REVEAL | (uint64 epoch, address token, uint256 threshold, bytes32 nonce) | 揭示上一期门槛，合约核对承诺 | 5 |
| 13 | PATROL_STATE | (address vault, address token, uint64 minute, uint256 S, bool alarm, bool gap) | CUSUM 检查点（P2）：minute 是已算到的最后一个完整分钟；基线 μ、σ 不在链上，是 config 里固定的 168 组（36_phase6.md 6.3），所以只需要 S。每 10 分钟写一次，alarm 改变时立即写，和当次的 QUOTA_REFILL 放同一份报告。合约只接受 minute 比现有检查点大的写入 | 6 |
| 14 | ASSET_CHECKPOINT | (bytes32 orgId, address token, uint64 safeBlock, int256 assetValue) | 对账检查点（P1，不依赖 CUSUM）：safeBlock 上这个 org、这种代币的 V（定义见 36_phase6.md 6.1）。由 quota handler **每次执行都写**（和 QUOTA_REFILL 同一份报告；没有要补的额度时单独写，Base 上成本低）。合约规则：safeBlock 递增；assetValue 不得小于现值（高水位），除非这个 org 的金库登记变了（合约自己从登记算 vaultSetHash，不信报告）或人员重设过（OfficerAction 9） | 6 |

decision：0 NONE、1 APPROVE、2 REJECT、3 PENDING。publicReason 只有 REJECT（关 1 到 3）才填，其余一律 0，避免泄露是哪一关。

**确认级动作包**（Trap、Patrol、Cosign 碰到诱饵时都用同一套，顺序固定）：FREEZE(温金库) → QUOTA_ZERO(热金库) → SWEEP(热金库) → ALERT(4) → COLD_DELAY → THREAT。

**gas：** writeReport 的 gasLimit 放 config（`reportGasLimit`），确认级动作包先用 1,500,000；阶段 2 用 estimateGas 实测后调整。

sealedReason：Cosign 用 ECIES（secp256k1 + AES-GCM）对每位人员的加密公钥各加密一份，拼在一起。**临时私钥 = HMAC(K, "seal" ‖ requestId ‖ 人员序号) mod n，AES nonce = HMAC(K, "nonce" ‖ requestId ‖ 人员序号) 前 12 字节**，这样每个节点算出同一份密文，才能共识。人员加密公钥（不是钱包地址，是单独的一对钥匙）列在 cosign config 的 `officerSealKeys`，由每位人员自己生成，私钥只在本人电脑。

packages/shared 提供 `encodeReport` / `decodeReport` / `seal` / `unseal`，workflow、测试、Console 都用同一份实现。

## 5. 事件（indexer 即 Ponder 订阅）

| 合约 | 事件 |
| --- | --- |
| RequestBoard | WithdrawalRequested |
| QuorumReceiver | ReportProcessed、ActionFailed、VerdictRecorded(txHash, decision, caseId)、VerdictDuplicate、VerdictDowngraded、Tightened(caseId, kind)、ThreatSkipped、AlertSet、FreezeSet、ManualQueued、ManualExecuted、QueuedCancelled、ScoreUpdated(scoreKey)、Ping |
| DecoyCommit | RootSet、ThresholdCommitted、ThresholdRevealed |
| QuorumReceiver（人员） | PlannedOpRegistered |
| PatrolState | PatrolStateUpdated |
| QuorumVault | Executed、Swept、QuotaZeroed、QuotaRefilled、TopUp、ProtectedLaneSet、ProtectedRelease（R7） |
| ColdVault | Queued、DelayRaised |
| ThreatRegistry | ThreatAdded |
| KeyRegistry | KeyRegistered、KeyRegistrationQueued、KeyChangeRequested、KeyChangeCancelled |
| DepositVault | Deposited |
| ConfigTimelock | ConfigQueued、ConfigExecuted、ConfigCancelled |
| MockERC20 | Transfer（不进 Ponder。读它的：Trap 的 log trigger、方式 B 的 sim-runner、trap-sync、Patrol 查运维 EOA） |

## 6. 原因代码（publicReason / sealedReason 用）

| 代码 | 含义 | 对外 |
| --- | --- | --- |
| 11 | R1 txHash 不符 | REJECT |
| 21 | R2 kind 1（Safe 交易）或不支持的操作 | REJECT |
| 22 | R2 代币不在清单 | REJECT |
| 23 | R2 金库不属于这个 org | REJECT |
| 31 | R3 签名人不是登记的钥匙，或没有钥匙 | REJECT |
| 32 | R3 字段与意图不符 | REJECT |
| 33 | R3 已过期 | REJECT |
| 41 | R4 诱饵账户 | PENDING（同时确认级） |
| 43 | R4 收款地址是诱饵地址 | PENDING（同时确认级，THREAT 跳过） |
| 42 | R4 收款地址在共享名单 | PENDING |
| 44 | R4 网络指纹命中（只记录，阶段 5 起作为 SPRT 信号） | 不改变决定 |
| 51 | R5 超过充值额度 | PENDING（阶段 3 起，按代币、不换算美元，倍数 1.0） |
| 61 | R6 数据源不一致 | PENDING（阶段 5） |
| 62 | R6 价格过期 | PENDING（阶段 5） |
| 71 | R7 超过隐藏上限 | PENDING（阶段 5） |
| 72 | R7 贴着假门槛（指纹） | PENDING（阶段 5） |

## 7. 默认参数（测试网，放 config，不写死）

| 参数 | 值 | 说明 |
| --- | --- | --- |
| VERDICT_TTL | 15 分钟 | APPROVE 有效期 |
| REPORT_MAX_AGE | 10 分钟 | 太旧的报告里只执行收紧类 action（3.2 第 4 步） |
| 提交额度桶 | A：容量 5、每 1.2 秒补 1；B：容量 4、每 1.5 秒补 1 | 合计每秒 1.5 个、容量 9，低于 CRE 每 6 秒 10 个（3.1） |
| RESUBMIT_AFTER | 2 分钟 | 距上次提交或重发多久才能再重发 |
| BACKLOG_AGE | 15 分钟 | 只有提交超过这么久仍没有裁决的请求才算积压 |
| BACKLOG_ALERT_TTL | 30 分钟 | 积压触发的 L1 期限；积压还在就由 Patrol 续期（同级只延长） |
| BACKLOG_MAX | 5 | 超过 BACKLOG_AGE 仍没有裁决的请求数超过它：不干净 + L1 |
| ANCHOR_LAG | 5 个区块 | cron handler 不用 latest，用 latest − 5 当锚点区块（第 9 节） |
| FREEZE_DURATION | 2 小时 | 确认级冻结温金库 |
| ALERT_TTL（确认级） | 2 小时 | |
| THREAT_TTL | 72 小时 | 名单有效期（合约上限 MAX_TTL 7 天） |
| COLD_DELAY 正常 / 收紧后 / 上限 | 24 小时 / 72 小时 / 7 天 | |
| MANUAL_DELAY | 10 分钟 | 人工放行、降级的排队时间（演示用短一些） |
| CONFIG_DELAY | 24 小时（演示 10 分钟） | |
| KEY_CHANGE_DELAY | 48 小时（演示 10 分钟） | |
| OFFICER_THRESHOLD | 2 | 部署时设 3 位人员 |
| 关 5 倍数 | 1.0（bigint 计算） | 已批准 + 本笔 ≤ 充值，按代币。proposal 写 1.5 是为了容纳交易利润；但 1.5 会让「抢先登记 + 自己充值」的攻击有利可图，比赛版改 1.0，利润部分转人工。已记入 STATUS 待决定 |
| MIN_DEPOSIT | 10 qUSD 或 0.005 qETH | hasDeposit 的门槛 |
| 热金库 qUSD cap / 初始 quota | 5,000 / 5,000 qUSD | 阶段 6 才有自动补充 |
| 热金库 qETH cap / 初始 quota | 2 / 2 qETH | |
| reportGasLimit | 1,500,000 | 阶段 2 实测后调整 |
| 网络跟随等级上限 | L1 | 见 proposal_v4 第 6 节 H |
| EPOCH_LEN | 1 小时（演示）/ 24 小时 | 隐藏门槛轮换 |
| T_min / T_max（qETH） | 2 / 8 qETH | 隐藏门槛范围（假门槛写 50） |
| QUOTA 补充间隔 / r_max | 60 秒 / 1,000 qUSD | 阶段 6 用公开数据重定 |
| CUSUM k / h | 0.5 / 5 | 阶段 6 用数据重调 |

## 8. 阶段 4 到 6 新增的接口

### 8.1 多家交易所（阶段 4）

- 一套 CRE workflow 服务两家：config 里有 `orgs` 映射 {orgId → receiver、hot、warm、cold、代币清单}。诱饵归属**不放在普通 config**：Trap 的 trigger 配置里本来就有诱饵地址（日志过滤需要明文，不可避免），在那里一并记归属；Cosign 用 tag → orgId 的映射（tag 由 K 派生，没有 K 看不出是谁）；Patrol 的原生币诱饵地址与归属放 secret `PATROL_DECOYS`
- ThreatRegistry 新增只读函数 `activeConfirmedCount()`：有效期内的确认级条目数。「跟随等级」是网络对生效等级的贡献，最多 1：生效等级 = max(本地等级, 有条目时 1)。只在 Cosign 内部用，不写链
- 关 4 新增：`fingerprintActive(fp)` 命中 → 原因 44，只记进 sealedReason，并作为阶段 5 SPRT 的信号；**单独命中不改变决定**

### 8.2 DecoyCommit（阶段 5）

| 函数 | 调用者 | 做什么 |
| --- | --- | --- |
| setRoot(orgId, root, leafCount) | ConfigTimelock | leafCount 必须是 2 的幂（补齐假叶子） |
| verify(orgId, chainId, ident, salt, proof) | 任何 | leaf = keccak256(bytes.concat(keccak256(abi.encode(chainId, ident, salt))))；OpenZeppelin MerkleProof（排序配对） |
| commitThreshold / revealThreshold | 只有 Receiver（THRESHOLD_COMMIT / REVEAL） | 存 c_e；揭示时核对 keccak256(abi.encode(T, nonce)) == c_e |

- 诱饵标识 ident：钱包和地址用 bytes32(address)，账户用 userIdHash
- salt_i = HMAC(K, "decoy" ‖ i)；i 和 proof 由 decoy-admin 生成，放 trap / cosign config（不进 git）
- THREAT 的 proof 字段 = abi.encode(ident, salt, bytes32[] path)。ThreatRegistry 写入前调用 verify，不通过就拒绝；衍生条目（parentEvidence ≠ 0）不需要证明
- DecoyCommit 每个 org 一个根；setRoot 走 ConfigTimelock；commitThreshold / revealThreshold 只接受该 org 已登记的 Receiver
- 合约能证明「这个诱饵是事先承诺过的」，**不能证明那笔触发交易真的发生过**；后者由 DON 核实，是信任 CRE 的部分

### 8.3 隐藏门槛（阶段 5）

- epoch e = floor(now / EPOCH_LEN)
- T_e = T_min + (HMAC(K, "thr" ‖ e) mod (T_max − T_min))，按代币分别算
- nonce_e = HMAC(K, "thrnonce" ‖ e)
- Patrol 在每期开始时写 THRESHOLD_COMMIT(e, keccak256(abi.encode(T_e, nonce_e)))，同时 THRESHOLD_REVEAL(e − 1, …)

### 8.4 SPRT 分数（阶段 5）

- 信号与 λ（千分之一 nat 的整数，放 cosign config，全部标「假设」）：

| 信号 | 从哪读（只用链上事实，不信后台） | λ 默认 |
| --- | --- | --- |
| 新账户：首次充值 < 7 天 | DepositVault.firstDepositAt(userIdHash) | 1200 |
| 新收款地址：这个用户没付过这个地址 | Receiver.seenRecipient(userIdHash, to)（APPROVE 执行时记录） | 900 |
| 贴着假门槛：金额落在假门槛下方 10% | 请求金额 + secret DECOY_THRESHOLD | 4605 |
| 网络指纹命中 | ThreatRegistry.fingerprintActive | 2303 |
| 最近被 PENDING | 解密后的旧分数里的 pendingCount | 500 |

- 同类上限：「新账户」与「新收款地址」合计 ≤ 1500
- 分数状态 (Λ, tLast, pendingCount) 用 AES-GCM 加密：key = HMAC(K, "scorekey")；**nonce = HMAC(K, "scorenonce" ‖ requestId ‖ keccak256(明文)) 前 12 字节**，明文不同 nonce 就不同，避免同一 nonce 加密两份不同明文；scoreKey = HMAC(K, "score" ‖ userIdHash)
- 时间一律取触发事件所在区块的区块头时间（headerByNumber），不用 runtime.now()；这样同一事件重跑，衰减、期限、密文都完全相同
- 每次裁决都写 SCORE，不论分数变没变
- 衰减：Λ ← Λ × γ^h，γ^h（h = 0 到 72 小时）预先算成整数表放 config
- 等级：L1 ≥ 2303、L2 ≥ 4605、L3 ≥ 6802
- 关 7（47 第 3 节，2026-10-06 改）：超过上限一律变成延迟的 APPROVE，不再 PENDING。L0 超过 T_e → D2；L1 → D1，超过 T_e / 2 → D2；L2 新收款地址或金额 > T_e / 4 → D2；L3 → D3。都是静默，不同原因共用档位，对外只看得到 notBefore。APPROVE 的 expiresAt = (notBefore 或区块时间) + VERDICT_TTL
- 47 R2：金额 > largeNew.minAmount[代币] 而且付新地址 → 延迟 largeNew.delay，sealedReason 记 73（R7_LARGE_NEW）。config 的 mode = shadow 时只写日志 `shadow=largeNew`，不改裁决
- 单一信号上限：thresholdHug、fingerprint、recentPending 各自最多 singleSignalCap = L3 门槛 − 1，单一信号到不了 L3；thresholdHug 的 λ 改 7,560

### 8.5 合约新增（阶段 5、6）

| 合约 | 新增 |
| --- | --- |
| DepositVault | firstDepositAt(userIdHash) |
| QuorumReceiver | seenRecipient(userIdHash, to)：consumeVerdict 成功时记录 keccak256(userIdHash, to)（阶段 1 就实现）；scoreOf(scoreKey) 返回密文 |
| QuorumVault（温） | topUp(token, amount)：只有 Receiver；目的地是构造时写死的热金库 |
| PatrolState | 存 PATROL_STATE；只有 Receiver 能写；Console 读 |

### 8.6 诱饵凭证（阶段 6，P2）

- 假 API key 不是交易所 API 的 key（交易所后台不可信，它可以压下回调），而是一个我们控制的假「托管签名服务」的 key，混在 exchange_a.api_keys 里
- 假服务（services/canary）收到任何使用 → 用 canary 私钥签一份 JSON → 调用 Trap 的 HTTP trigger
- Trap 的 HTTP trigger：`authorizedKeys` = canary 服务的地址；每 30 秒最多 1 次，足够
- 方式 B：canary 服务调用 sim-runner 的本地接口，sim-runner 执行 `simulate workflows/trap --trigger-index <http handler> --http-payload @payload.json --broadcast`
- 判定为确认级；suspect = 0

## 9. QuorumLens 与读取预算

CRE 每次执行最多 15 次 EVM read。所以加一个**只读**合约 QuorumLens（阶段 1 就部署），一次 callContract 返回一个 workflow 需要的全部链上状态。Lens 没有任何会改状态的函数。

| Lens 函数 | 给谁用 | 返回 |
| --- | --- | --- |
| cosignView(orgId, userIdHash, token, to, fp) | Cosign | keyOf、各代币 depositedOf 与 approvedOf、firstDepositAt、seenRecipient、isSuspect(to)、fingerprintActive(fp)、activeConfirmedCount、alert、scoreOf、Price Feed 的 answer 与 updatedAt |
| patrolView(orgIds[], addresses[]) | Patrol | 每个 org：reqRing、verdictRing、各金库的各代币余额、quota、lastEpoch、cap、alert、frozenUntil、configHash、outStats；热金库的 outRing；传入地址（诱饵、运维 EOA）的原生币与代币余额；PatrolState；时间区间与 [检查点分钟, 锚点分钟] 重叠的 PLANNED_OP（含已过期的） |

Lens 用 callContract 调用，属于 eth_call，不上链，传进去的诱饵地址不会公开。

**每个 handler 的预算（验收时记录实际用量）：**

| workflow / handler | 触发 | EVM read | HTTP | secret |
| --- | --- | --- | --- | --- |
| trap / log A、log B | 诱饵 Transfer（LATEST） | getTransactionReceipt 1、headerByNumber 1 | NOWNodes eth_getTransactionReceipt 1，只在该链有 NOWNodes 端点时（Ethereum Sepolia）。收据与触发日志矛盾则不写报告（D48）；NOWNodes 不可用（null、HTTP 错误、节点不一致）则按 CRE 收据照常写（审计 2026-10-07 H2） | 2（K、NOWNODES_KEY） |
| trap / http | canary 回调 | headerByNumber 1 | 0 | 1 |
| cosign / main（唯一的 handler） | WithdrawalRequested（**LATEST**） | headerByNumber 1、cosignView 1 | NOWNodes 1（关 6） | 4 |
| patrol / decoys | cron 60 秒 | headerByNumber 1、patrolView 2（锚点与锚点 − N；读不到旧区块时改和 PatrolState 存的上次余额比） | XRP 1（P2） | 2（K、PATROL_DECOYS） |
| patrol / reconcile | cron 60 秒 | headerByNumber 2（锚点、SAFE）、patrolView 2（锚点、SAFE）、运维 EOA 的 filterLogs ≤ 2；金库对账不读日志 | 0 | 1 |
| patrol / quota（含 CUSUM、ASSET_CHECKPOINT） | cron 60 秒 | headerByNumber 3（锚点、SAFE、finalized）、patrolView 3（锚点、SAFE、FINALIZED；CUSUM 用锚点那份的 outRing、PatrolState 检查点、与区间重叠的 PLANNED_OP） | 0 | 0 |
| patrol / epoch | cron 每小时 | headerByNumber 1 | 0 | 1 |
| patrol / trace（P2） | cron 60 秒，只在有活跃案件时 | filterLogs ≤ 5 | 0 | 0 |
| patrol / verify-edge（trigger 5，2026-10-07 实现） | HTTP（Trek 提出的边，每 30 秒最多 1 次） | headerByNumber 2（锚点）、getTransactionReceipt ≤ 12（按 txHash 去重）、Multicall3 一次（父地址 isSuspect + 父证据 evidenceExpiresAt，锚点区块） | 0 | 0 |

**两家交易所共用 Patrol 时**，patrolView 一次传两个 orgId，上表的读取次数不变；回复大小（outRing 每个热金库每种代币 32 个 word，约 1 KB）在 S9 一起量。

**cron handler 的锚点区块：** 不同节点看到的 latest 可能差一两个区块，会让「最后一个完整分钟」和读到的状态不一样，节点就无法共识。所以 cron handler 一律用 latest − ANCHOR_LAG 当锚点，所有读取指定这个区块号，分钟 = floor(锚点区块时间 / 60) − 1。这只能降低不一致的机率，本地 simulate 是单节点，证明不了；方式 A 时看 DON 的执行记录有没有共识失败。

每个 handler 是独立执行，各自有预算；一个 workflow 最多 10 个 trigger，trap 3 个、cosign 1 个、patrol 6 个（含 P2 的 verify-edge）。**log trigger 的限流（每 6 秒 10 个事件）按 workflow 计**，同一 workflow 的所有 log trigger 共用，所以 Cosign 只留一个 handler，每个请求只占一份额度（42_performance.md 第 1、3 节）。

链下服务（exchange-api、Console、sim-runner、红队）批量读合约用 Multicall3（Base Sepolia：`0xcA11bde05977b3631167028862bE2a173976CA11`）。

**放宽的双重保险：** quota handler 只在 LATEST 和 FINALIZED 两份数据都「干净」（alert < 4、没冻结、对账干净）时才补；合约层面 refillQuota 和 topUp 在 alert = 4 或冻结时直接拒绝。Base Sepolia 的 finalized 可能落后约 20 分钟，只靠 FINALIZED 读数会在收紧后又补回额度，所以链上兜底是必须的。

## 10. 补充定义

| 项目 | 定义 |
| --- | --- |
| K 在哪 | CRE secret `QUORUM_K`；离线计算（tag、salt、Merkle）用安全负责人本地的 `secrets/quorum_k.local`，只在 decoy-admin 里读 |
| 人员名单 | 一个 OfficerSet 合约（阶段 1），Receiver、ColdVault、KeyRegistry、ConfigTimelock、DecoyCommit 构造时写死它的地址；人员变更走 ConfigTimelock |
| 假门槛（后台 risk_config 写的） | qETH 5、qUSD 5,000（演示把 proposal 的「50 ETH」等比例缩小，视频说明） |
| 真门槛范围 T_min / T_max | qETH 1 到 3；qUSD 500 到 2,000 |
| 热金库补充目标（TOPUP） | qUSD 8,000、qETH 2 |
| QUOTA_PERIOD / r_max | 60 秒 / 每期 1,000 qUSD、0.3 qETH |
| 金额区间编号 | floor(log2(amount / 0.01 个代币))，截到 0 到 40 |
| fingerprint 动作类型 | 共用枚举：1 PROBE（小额试探：诱饵转出、或金额在区间 ≤ 7 的提款请求）、2 THRESHOLD_HUG（贴着假门槛）。Trap 与 Cosign 都用这个枚举，才可能对上 |
| ALERT 期限 | 4（确认级）2 小时；2（Patrol 发现运维 EOA 异常，或锚点区块看到资产守恒变小）2 小时，状况还在就由 Patrol 每次执行续期（同级只延长）；1（积压）BACKLOG_ALERT_TTL |
| L1_DELAY | 10 分钟 |
| CUSUM | 168 组 (μ, σ) 固定放 Patrol config（BigQuery H0 离线算），不在线学习；σ 下限 50（对数 × 1000 的单位）；k = 0.5、h 先取 5，6.6 用公开数据重调 |
| 关 6 容差 | 同一区块的 depositedOf 必须完全相等；价格 updatedAt 超过 1 小时算过期 |
| 时间来源 | 写上链的时间（issuedAt、expiresAt、notBefore、衰减）一律用触发区块的区块头时间；cron 用锚点区块（latest − ANCHOR_LAG）的区块头 |
| 日志 | workflow 与服务日志只打 tag 或案件编号，不打诱饵地址或诱饵 userIdHash |
| 部署时的循环依赖 | Receiver 与 ThreatRegistry 互相需要地址：用一次性的 initialize（只有部署者、只能调用一次，之后锁死），权限清单里标注 |

## 47 第二阶段的合约接口（2026-10-06，docs/47_risk_framework.md）

| 合约 | 新增 | 说明 |
| --- | --- | --- |
| RequestBoard | `recipientOf(requestId) → address` | 提交时记下用户签名里的 `to`（intent.to），Receiver 判断「新地址」用 |
| QuorumReceiver | Config 新增 `largeNewDelay`、`holdMax`、`largeNewTokens[]`、`largeNewMins[]` | 构造时写入；`largeNewDelay`、`holdMax` 部署后不能改 |
| QuorumReceiver | `largeNewMin(token)`；`setLargeNewMin(token, min)`（只有 ConfigTimelock） | R2 的 L_pub，0 = 关闭 |
| QuorumReceiver | 合约 floor：登记 APPROVE 时，金额 > largeNewMin[token] 而且 (userIdHash, recipientOf) 从没付过 → notBefore 至少 = 登记时间 + largeNewDelay；expiresAt 至少 = notBefore + verdictTtl | CRE 写的 notBefore 只能被加长。事件 `LargeNewFloor(txHash, notBefore)` |
| QuorumReceiver | `holdVerdict(txHash, until, nonce, deadline, sigs)`：OfficerAction kind 10（HOLD_VERDICT），**一位人员** | 只对还没用掉的 APPROVE；until ≤ 现在 + holdMax；同一笔在上一次 HOLD 到期后要再等 holdMax 才能再 HOLD；HOLD 时把 expiresAt 至少延到 until + verdictTtl。事件 `VerdictHeld(txHash, until)` |
| QuorumReceiver | `cancelVerdict(txHash, nonce, deadline, sigs)`：kind 11（CANCEL_VERDICT），**两位人员** | 标记 released，退回 approvedOf。事件 `VerdictCancelled(txHash)` |
| QuorumReceiver | `heldUntil(txHash)`；consumeVerdict 在 HOLD 期间 revert `Held()` | |
| QuorumVault | Config 新增 `hourCaps[]`、`dayCaps[]`（可为空 = 不限）；`setWindowCaps(token, hourCap, dayCap)`（只有 ConfigTimelock） | 非人工放行的出金同时受「每小时、每天」上限约束，固定时间窗（UTC 整点、整天）。超过 revert `WindowExceeded()` |

R7 不在第二阶段；之后以「受保护车道」实现（见本文末节，默认关），proposal 第 4 节的回写见 STATUS 待决定。

## OfficerDesk（2026-10-06，47 第 3.2 步，合约大小）

QuorumReceiver 的人员动作全部搬到每个 org 一个的 `OfficerDesk`，Receiver 只保留状态与检查：

| 合约 | 内容 |
| --- | --- |
| OfficerDesk（继承 OfficerAuth） | `extendFreeze`、`queueManual` / `executeManual`、`queueLowerAlert` / `executeLowerAlert`、`cancelQueued`、`holdVerdict`、`cancelVerdict`；排队状态 `queued`；事件 ManualQueued、ManualExecuted、QueuedCancelled。构造时写死 officerSet 与 receiver，没有 owner、没有配置 |
| QuorumReceiver | 不再继承 OfficerAuth；`desk` 在 initialize 一次写入；只有 desk 能调 `deskExtendFreeze`、`deskManualApprove`、`deskLowerAlert`、`deskHold`、`deskCancelVerdict`，所有状态检查（只能延长、holdMax、冷却、未用过的 APPROVE）留在这里。事件 FreezeSet、AlertSet、VerdictHeld、VerdictCancelled 仍由 Receiver 发 |

- Receiver 相关 OfficerAction（kind 1、2、3、6、10、11）的 verifyingContract 从 Receiver 改为该 org 的 desk；Console、officer-cli 签名时 target 填 desk 地址
- deployments JSON 每个 org 新增 `desk`；Ponder 加索引 OfficerDesk
- 规则 3 不变：Receiver 听的仍只有白名单 workflow（经 forwarder）和两位人员联名（经 desk）；desk 地址 initialize 后不能改

## 用户自己取消排队中的提款（2026-10-06，47 第 3.3 步）

- EIP-712 类型 `CancelWithdrawal(bytes32 txHash, uint64 deadline)`；domain：name "QuorumReceiver"，version "1"，chainId，verifyingContract = 该 org 的 Receiver
- `QuorumReceiver.userCancelVerdict(txHash, deadline, sig)`：签名人必须是 KeyRegistry 里这个账户目前登记的钥匙；只对还没用掉、没被取消的 APPROVE；谁都可以代送（用户没有 gas 时由 relayer 或 keeper 送）。成功后标记 released、退回 approvedOf，发 `UserCancelled(txHash)`。不用 nonce：取消过的裁决不能再取消，digest 绑定合约地址与 txHash
- `cancelDigest(txHash, deadline)` 是 view，供前端核对；共享向量见 packages/shared/test/vectors.ts `cancelDigest`
- PENDING 没有链上可取消的东西；用户看到的 ETA 来自 `verdictOf(txHash).notBefore`（直接读链，不经后台）

## 通知服务 notifier（2026-10-06，47 第 3.5 步）

- 只读链：RequestBoard.WithdrawalRequested（金额、收款地址、userIdHash）、Receiver.VerdictRecorded（再读 verdictOf 拿 notBefore）、VerdictHeld、UserCancelled、VerdictCancelled、金库 Executed
- 讯息种类：delayed（"Withdrawal of X to 0xAB…CD releases in N min. Not you? Cancel it in the app before then."）、approved、pending、rejected（签名不是你的）、held、cancelled（用户 / 人员）、paid
- 投递：`NOTIFY_WEBHOOK_URL`（团队频道）加 `quorum_index.notify_channels(user_id_hash, url)` 的每用户 URL；payload 是 JSON `{txHash, userIdHash, kind, text}`。角色 `notifier_svc` 只能读这张表（migration 20261006000400）
- 启动时从最新区块开始（`NOTIFY_FROM_BLOCK` 可覆盖），同一笔同一种讯息只送一次（进程内去重）；停机期间的事件不补发，这是已知限制

## 3.7：第二因素与钥匙找回（2026-10-06，46 第 5、6.3 节；修安全审查 High 3「换钥匙劫持」）

KeyBinding 的 action 新增：4 ROTATE、5 APPROVE_RECOVERY、6 FACTOR、7 CANCEL_FACTOR。两把钥匙共签的动作签**同一个** digest（同一个 nonce）。KeyRegistry 构造多一个 `recoveryDelay`（长，正式 7 天）；原本的 `keyChangeDelay` 是短延迟。

| 函数 | 谁签 | 效果 |
| --- | --- | --- |
| `rotateKey(userIdHash, newKey, deadline, sigCurrent, sigNew)` | 目前的钥匙 + 新钥匙（action 4） | 立即生效。换手机、加装置走这条，不用等 |
| `requestKeyChange(userIdHash, newKey, deadline, sigNew)`（找回） | 只有新钥匙（action 2） | 排队 **recoveryDelay**（原本只等 keyChangeDelay，这就是 High 3：任何人都能替任何账户发起，等短延迟过了就接管）。期间目前的钥匙或第二因素可取消，一位人员也可取消 |
| `approveRecovery(userIdHash, deadline, sigFactor)` | 登记的第二因素（action 5） | 把排队中的找回缩短到 keyChangeDelay。没登记第二因素就不能用 |
| `cancelKeyChange(userIdHash, deadline, sig)` | 目前的钥匙**或**第二因素（action 3） | 取消找回 |
| `registerSecondFactor(userIdHash, factor, deadline, sigKey, sigFactor)` | 目前的钥匙 + 第二因素（action 6） | 账户还没有余额：立即生效；有余额：排队 keyChangeDelay（偷到主钥匙的人没办法马上把自己加成第二因素），期间目前的钥匙可取消 |
| `finalizeSecondFactor(userIdHash)` / `cancelSecondFactor(userIdHash, deadline, sigKey)` | 任何人 / 目前的钥匙（action 7） | |

- 第二因素是一个地址（硬件钱包、另一台装置的 passkey 的 keyId、充值钱包），签名格式同样接受 ECDSA 或 WebAuthn blob
- 第二因素生效后，`secondFactorOf(userIdHash)` 可读；一个账户一个，要换先取消
- 没做：46 的争议裁决（DISPUTE_SLA）、第二因素「太新」的例外、充值钱包快照；user-app 与 exchange-api 还没有这些动作的界面与代送，先由脚本或钱包直接调用

## 3.6：passkey 的新地址 floor、换钥匙后的付款检查、地址首次付款时间（2026-10-06，46 第 5、6.1、6.3 节）

| 合约 | 新增 | 说明 |
| --- | --- | --- |
| RequestBoard | `signerKindOf(requestId) → uint8`：0 无效、1 钱包 ECDSA、2 passkey | 提交时记下签名格式 |
| QuorumReceiver | Config 新增 `passkeyNewDelay`（部署后不能改）；登记 APPROVE 时，signerKind = 2 而且 (userIdHash, recipient) 从没付过 → notBefore 至少 = 登记时间 + passkeyNewDelay；事件 `PasskeyNewFloor(txHash, notBefore)` | 46 第 5 节的盲签对策：passkey 签的是看不到内容的 digest，付新地址先等 D1，期间 notifier 会通知、用户能取消。钱包签名不受此限 |
| QuorumReceiver | `seenAt(userIdHash, to) → uint64`：第一次付款的区块时间（0 = 没付过）；`seenRecipient` 保留 | 46 第 6.1 节「已知地址」与「成熟地址」的基础；成熟（seenAt + ADDRESS_MATURE_AGE）这一期只记录，还没有规则用它 |
| QuorumReceiver | `consumeVerdict` 的 APPROVE 路径多一项：`requestBoard.signerOf(requestId)` 必须仍等于 `keyRegistry.keyOf(userIdHash)`，否则 revert `KeyChanged()` | 46 第 6.3 节钥匙世代的最小版：钥匙换掉以后，旧钥匙签的、还在排队的提款不会付出去；用户用新钥匙重新提交。人工放行（manualOf）不经这项检查 |

没做、记入 STATUS 待决定：两类预算（TRUSTED / GENERAL，46 第 10 节）与信任等级 T1 到 T3，需要 KeyRegistry 记钥匙年龄、金库按类别分桶、Patrol 分别补充，改动跨三个合约，等团队决定 ADDRESS_MATURE_AGE 与 KEY_TRUST_AGE 再做。

## passkey（P-256 / WebAuthn）钥匙（2026-10-06，47 第 3.4 步，46 第 5 节）

- **钥匙 id：** P-256 公钥 (qx, qy) 的 id = `address(uint160(uint256(keccak256(abi.encode(qx, qy)))))`。KeyRegistry 的 `keyOf`、RequestBoard 的 `signerOf`、Cosign 的关 3、Receiver 登记 APPROVE 时的比对全部沿用 address，不用改
- **签名格式：** `userSig.length == 65` 走 ECDSA（原路径）；否则是 `abi.encode(WebAuthn.Auth)`：`(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, bytes32 r, bytes32 s, bytes32 qx, bytes32 qy)`。公钥随签名一起送，合约不查登记表就能验；签名人 = keyIdOf(qx, qy)
- **验签（lib/WebAuthn.sol）：** authenticatorData ≥ 37 bytes 且 UP 位为 1；clientDataJSON 在 typeIndex 处是 `"type":"webauthn.get"`、在 challengeIndex 处是 `"challenge":"base64url(digest)"`（无填充）；消息 = sha256(authenticatorData ‖ sha256(clientDataJSON))；P256.verify（Base 的 0x100 预编译，没有就退回纯 Solidity；s > N/2 一律拒绝）。challenge 就是原本的 EIP-712 digest（KeyBinding 或 Withdrawal），所以 passkey 签的内容和钱包签的完全一样
- **RequestBoard.submit：** 无效或格式错误的 blob 记 signer = 0、不 revert（经 `webauthnSigner` 外部 view 加 try/catch），和 ECDSA 的 tryRecover 一致；判断仍是 Cosign 的事
- **KeyRegistry：** `register` / `requestKeyChange` / `cancelKeyChange` 的 sig 都接受两种格式；passkey 登记时 key 参数填 keyId。合约不存公钥，公钥在登记交易的 calldata 里
- **用户没有 gas：** exchange-api 新增 `POST /keys/register`（只转发 register 调用，签名由合约检查）；提款请求本来就是后台提交。passkey 的盲签 floor（46 第 5 节：passkey 付新地址至少 D1）在 3.6 做
- **共享 TS（packages/shared/src/webauthn.ts）：** `p256KeyId`、`encodeWebAuthnSig`、`lowS`、`derToRS`、`clientDataFor`、`softwarePasskey`（测试与 E2E 用的软件认证器）。浏览器端用 `navigator.credentials`，公钥取 `getPublicKey()` 的 SPKI 最后 64 bytes

## R7 受保护车道（2026-10-07，QuorumVault；需求见 docs/47 的 R7，设计变更见 STATUS D112）

冻结 / CONFIRMED 期间,给正常用户留的一条窄车道。默认关闭,`setProtectedLane` 由 ConfigTimelock 开。

- `setProtectedLane(token, smallCap, cap, refillPerMin, reserve, matureAge)`:cap = 0 关闭。设置时把 R 预算 `pBudget[token]` 初始化为 cap。参数都按 token 存（`matureAge(token)` 也是）。开启时 matureAge 必须 > 0、reserve ≤ cap；关闭时 reserve 必须为 0，否则 revert `BadLane`（审计 2026-10-07）。
- 放行条件(全部满足,否则按原样 revert Frozen / AlertConfirmed):收款地址是成熟地址(这笔付款之前的 `receiver.seenAt(userIdHash, to)` 不为 0 且已过 matureAge；金库在 consumeVerdict 之前读取)、金额 ≤ smallCap、独立预算 R 够(每分钟补 refillPerMin,上限 cap)。用的是 R,不是 quota(quota 已被 QUOTA_ZERO 清零)。
- `sweepToCold` 改为只扫 `balance - reserve[token]`,留下 reserve 给这条车道。
- 两人联名(manual)仍被硬冻挡(isFrozen 在最前),语义不变。
- 攻击者用不了:仍需真实用户签名(关 3)+ 用户以前付过的成熟地址 + 小额,被 R 限速。
- 事件:`ProtectedLaneSet`、`ProtectedRelease`。没做:信任等级 T3(用成熟地址代替)。

## demo-approve（演示专用 workflow，2026-10-07 登记）

`workflows/demo-approve` 只给 `services/redteam/demo/e2e.ts` 用：写一笔 APPROVE，让后面的热库 execute 走到 `AlertConfirmed`。它不评分、不过关卡、不收紧。只在 SIM 模式部署上可用（SIM 放行所有种类）；workflow 名 `quorum-demo-approve` 不在 PROD 白名单里，也不能加进去；workflow.yaml 只有 staging-settings。读取：headerByNumber 1；写入：VERDICT 1。

## patrol verify-edge（trigger 5，2026-10-07；docs/36 6.4）

链下 Trek（不可信，只提议）经 HTTP trigger 交来至多 12 条边；CRE 逐条核实后才写衍生 THREAT。payload（JSON）：

```json
{ "v": 1, "orgId": "0x…32 字节", "edges": [
  { "parent": "0x…", "child": "0x…", "txHash": "0x…", "logIndex": 0, "token": "0x…", "amount": "2000000", "parentEvidence": "0x…" } ] }
```

- 整个 payload 格式不对就整批拒绝；orgId 必须是 config 里的 org，报告写到该 org 的 Receiver。
- 每条边：receipt status 1、所在区块 ≤ 锚点（latest − anchorLag）、`logIndex`（区块内序号，与 log trigger 和 eth_getLogs 一致）那条是 config 内代币的 Transfer，from = parent、to = child、金额相等；金额 ≥ `verifyEdge.minAmounts`（防撒灰）；child 不是我方合约；parent ≠ child。
- 父条件：parent 地址在锚点是 suspect，**而且** parentEvidence 在锚点仍有效；或二者都来自同一批里前面已核实的边（Receiver 依序执行 THREAT，链上看到的也是父在前）。
- 写入：`evidenceHash = keccak256(abi.encode(chainId, txHash, logIndex))` 与 `expiresAt = 锚点时间 + verifyEdge.derivedTtl`（默认 24 小时）都由 workflow 自己算，不采用 Trek 给的值；`proof = 0x`、`fingerprintHash = 0`。同一证据再送只会被 ThreatRegistry 忽略（不加 count）。
- 原生币边（`logIndex = 0xFFFFFFFF`）现在拒绝（`native-unsupported`）：receipt 里没有金额。
- 日志只打各原因的计数（例如 `verify-edge amount-mismatch=1 ok=1`）。
- config（`verifyEdge`，没有就返回 `verify-edge disabled`）：threatRegistry、multicall3、maxEdges（≤ 12）、derivedTtl、minAmounts（顺序同 tokens）、authorizedKeys（DON 部署时填）。
- 链下部分：`analysis/trace_bybit/fork_source.py`（任何 JSON-RPC，真实 chainId）；端到端：`pnpm demo:trace`（services/redteam/demo/trace-fork.ts）。
