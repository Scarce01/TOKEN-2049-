# 阶段 4：蜂群网络（第 17 到 22 小时）

## 目标

交易所 A 被碰的攻击者，换去交易所 B 提款：
- 同一收款地址 → B 转人工
- 同样的手法 → 记成信号
- B 的警戒最多跟到 L1

Console 有 Network 页和 Timeline 页，能回放「第一笔测试转账就被标记」。这是视频 1:55 到 2:15 的高潮。

## 前提

阶段 3 完成；`reset-demo` 已跑。

## 任务

### 4.1 部署交易所 B

- 第二套 QuorumReceiver、热 / 温 QuorumVault、ColdVault；RequestBoard 登记 B 的提交地址（ConfigTimelock）
- ThreatRegistry 的 reporter：reset-demo 本来就会重新部署 ThreatRegistry，所以 A、B 两个 Receiver 都在它的一次性 initialize 里登记，不走 10 分钟的 ConfigTimelock
- exchange_b schema 种子：50 个账户 + 5 个诱饵账户，同样走 20_data.md 第 4 节的流程
- apps/exchange-api 以 `ORG=b` 启动第二个实例，用 `exchange_b_app` 角色
- `reset-demo` 扩展：可选只重置 A 或 A + B

### 4.2 CRE 服务两家（不增加 workflow 数量）

- 三个 workflow 的 config 改成 `orgs` 映射（10_interfaces.md 8.1）
- Cosign：用事件 orgId 选 org 配置；报告写到该 org 的 Receiver
- Trap、Patrol：诱饵按归属选 Receiver；两家的诱饵合计不能超过 log trigger 的上限（每个 trigger 5 个地址、每个 topic 位置 10 个值），超过就拆成两个 handler（每个 workflow 最多 10 个 trigger）
- 关 4：
  - 地址命中 → PENDING 42（已有）
  - 指纹命中 → 原因 44 写进 sealedReason，不改变决定
  - 跟随等级：`activeConfirmedCount() > 0` 时，B 的生效等级至少 L1。阶段 5 前 L1 没有实际效果，只记录；阶段 5 后 L1 让关 7 上限减半

验收（模拟）：同一份 Cosign 代码，分别对 A、B 的请求跑，报告写到正确的 Receiver。

### 4.3 Trap 写指纹

- fingerprintHash 按 10_interfaces.md 第 1 节（不含地址）计算，写进 THREAT
- 金额区间：log2 分桶，边界放 config；红队 probe 的 0.84 qUSD 和贴假门槛的金额要落在可辨认的桶里

### 4.4 红队新增

| 命令 | 做什么 | 预期 |
| --- | --- | --- |
| `hop --to b` | A 被碰之后，攻击者在 B 用 `register-hijack --new --self-fund` 控制一个账户（自己的钥匙、自己的小额充值，所以关 1 到 3、关 5 都会过），再提款到 A 那次留下的同一收款地址 | B：PENDING 42。用伪造签名去 B 的话，关 3 会先拒，看不出网络效果，所以必须这样设计 |
| `hop --to b --new-addr` | 同上但换全新地址、同样的试探金额区间 | B：决定不变（单一指纹只是 L1 信号）；sealedReason 有 44。证明「换地址认不出，但手法有记录」 |
| `hop --to b --honest` | B 的正常用户正常提款 | APPROVE（证明网络不会误伤 B 的正常用户） |

### 4.5 Console：Network 与 Timeline

| 页面 | 显示 | 数据 |
| --- | --- | --- |
| Network | 名单条目：地址、哪家写的、证据（交易链接）、指纹、到期时间、在其他交易所的命中次数；两家交易所并排的状态卡片 | ThreatRegistry 读 + quorum_index |
| Timeline | 选一个攻击者地址：把两家的事件按时间排好（测试转账 → Trap → 收紧 → 名单 → B 转人工），每个事件可点开交易 | 服务端路由组合：第一个点取 quorum_index.traps.tripped_tx，其后按 case_id 与 suspect 接 ponder_quorum.chain_events（20_data.md 3.2b） |

Timeline 的第一个点必须是那笔测试转账，并标注「marked here」（D43 用 E2E 检查页面数据源的第一条记录）。

### 4.6 指标

- `network_recognition_seconds`：ThreatAdded 的区块时间到 B 的 VerdictRecorded（PENDING 42）的区块时间；source = testnet_measured
- 跑 3 次

## 设计一致性（必须通过，见 40_verification.md）

D13、D12（不含 Merkle 部分）、D14.4、D34、D29（扩展到 exchange_b）、D43

## 完成标准

- [ ] 4.4 三个命令结果符合预期
- [ ] Network、Timeline 页可用；Timeline 第一个点是测试转账
- [ ] network_recognition_seconds 有实测
- [ ] 仍然只有 3 个 workflow
- [ ] `pnpm verify:design --phase 4` 全过
