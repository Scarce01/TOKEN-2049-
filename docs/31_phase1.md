# 阶段 1：地基（第 0 到 5 小时）

## 目标

仓库、数据库、种子数据、合约 v0、部署都就位；CRE 写一份 PING 报告上链，合约状态真的改变；跑完风险 spike，决定 CRE 用方式 A 还是方式 B。

## 不在本阶段

诱饵钱包、Trap 逻辑、Cosign 七关、ThreatRegistry、前端页面（只建空壳）。

## 三条可以并行的线

| 线 | 任务 |
| --- | --- |
| 合约 | 1.3、1.4 |
| 数据 | 1.1、1.2、1.8 |
| CRE | 1.5、1.6、1.7（spike 越早做越好） |

## 任务

### 1.1 仓库脚手架

- pnpm workspaces，目录按 00_overview.md 第 3 节建好
- 根目录 tsconfig.base.json（strict）、Biome、.gitignore（`.env*`、`secrets/`、`workflows/**/config.*.json` 但保留 `config.example.json`、`deployments/*.local.json`）
- `packages/shared`：constants（chain、orgId、代币小数位）
- proposal_v4.md 与 docs/diagrams 已在仓库

验收：`pnpm install`、`pnpm -r build` 通过。

### 1.2 Supabase 本地

- `supabase init`；migrations 建 exchange_a、exchange_b、quorum_index、datasets 四个 schema 和 20_data.md 第 3 节的表（exchange_b 先建空表）；ponder_quorum 只建空 schema，表由 Ponder 建
- 角色 `exchange_a_app`、`exchange_b_app`、`quorum_svc`、`ponder_svc`、`trap_sync_svc`、`console_svc`、`datasets_rw`，按 20_data.md 第 2 节 GRANT
- quorum_index 开 RLS：只放行 `app_metadata.role = 'officer'` 的登录用户；officer_signatures 允许 officer insert；只对 traps、officer_signatures 开 Realtime
- ponder_quorum：owner 是 `ponder_svc`（Ponder 用它连接，它对其他 schema 没有任何权限）；`console_svc` 只有 SELECT（`ALTER DEFAULT PRIVILEGES FOR ROLE ponder_svc IN SCHEMA ponder_quorum GRANT SELECT ON TABLES TO console_svc`）；REVOKE anon、authenticated、PUBLIC 对这个 schema 的 USAGE；不加进 PostgREST 的 exposed schemas
- 查 pg_partman：`select name, default_version from pg_available_extensions where name = 'pg_partman'`，结果记进 STATUS（只影响路线图的分区，比赛版不用）
- 建 3 个人员测试账号（Supabase Auth，email OTP），用 service key 设 role
- `seed.sql`：risk_config（含假门槛）、普通白名单地址

验收（写成自动化测试，`pnpm test:db`）：
- anon key select quorum_index 任何表 → 失败
- anon key select exchange_a.users → 失败
- `exchange_a_app` select quorum_index.traps → 失败
- 非 officer 登录用户 select traps → 失败；officer → 成功
- anon、authenticated select ponder_quorum 任何表 → 失败；ponder_svc select quorum_index.traps → 失败；console_svc update traps、insert / update / delete ponder_quorum → 失败；trap_sync_svc 只能 update traps 的状态栏位
- PostgREST 公开的 schema 清单里没有 ponder_quorum、quorum_index

### 1.3 合约 v0（Foundry）

按 10_interfaces.md 第 3 节。阶段 1 实现下表，其余函数先 revert `NotYet`：

| 合约 | 阶段 1 实现 |
| --- | --- |
| MockERC20 + Faucet | qUSD、qETH；只有 Faucet 能 mint，每个地址每小时有上限；seed 脚本用的地址有单独额度 |
| QuorumReceiver | immutable 的 forwarder / mode / simOperator；onReport 全部检查（PROD / SIM）；kind 白名单；`applyAction` onlySelf + try/catch；action 实现 PING、FREEZE、ALERT（含等级 4 与同级延长）；seenRecipient 存储（先建好，阶段 3 使用） |
| QuorumVault | VaultTx 与 txHash 重算；execute 的冻结、alert < 4、代币清单、quota 检查；(userIdHash, nonce) 只付一次；fund()、outStats、outRing（10_interfaces.md 3.3）；consumeVerdict 接 Receiver（阶段 1 Receiver 还没有 VERDICT，所以 execute 一律 NoVerdict）；sweepToCold、zeroQuota |
| ColdVault | receive；raiseDelay |
| RequestBoard | submit 全部检查 + EIP-712 恢复 signer + 用意图 nonce 标记 + 事件；按 org 的提交额度桶；txHashOf、signerOf、submittedAt；reqRing；resubmit（10_interfaces.md 3.1） |
| KeyRegistry | register、registerBatch（有充值的账户首次登记进入排队）、keyOf |
| DepositVault | deposit、depositBatch、depositedOf、hasDeposit、firstDepositAt；收到的钱转到交易所收款地址（构造时写死） |
| OfficerSet | 3 位人员、门槛 2；签名验证的公共库；人员变更只接受 ConfigTimelock |
| QuorumLens | 只读：cosignView、patrolView（10_interfaces.md 第 9 节）；阶段 1 先返回已有合约的字段，后续阶段随合约补 |
| ConfigTimelock | queue（两人签名）、execute（等 CONFIG_DELAY）、cancel（一人）；Receiver、Vault、RequestBoard 的配置函数只接受它 |

forge 测试至少覆盖：

- onReport：非 forwarder 被拒；PROD 模式 owner 或 workflowName 不对被拒；metadata 62 与 64 字节都能解；SIM 模式 tx.origin 不对被拒；chainId 不对、过期都被拒
- kind 白名单：trap 发 VERDICT 被拒（`ActionFailed`）
- 一个 action revert 时，其他 action 仍执行
- 同一份确认级报告送两次，状态与送一次完全一样
- ALERT 棘轮：低等级不能覆盖未过期的高等级；同级只延长；过期后可以降
- FREEZE 只延长；冻结时 execute revert `Frozen`；alert = 4 时 execute revert `AlertConfirmed`
- txHash：改 requestId 或 userIdHash 任一字节，重算结果就不同
- RequestBoard：EIP-712 恢复结果与 viem 一致（固定测试向量，shared 用同一组）；requestId 重复、意图 nonce 重复都被拒；同一 org 超过额度桶 revert，另一个 org 不受影响；resubmit 在内容 hash 对不上或未满 RESUBMIT_AFTER 时 revert（不查有没有裁决）
- QuorumVault：同一 (userIdHash, nonce) 第二次 execute revert；outRing 跨分钟覆盖正确；outStats 只增不减，topUp 不计入 extOutTotal；fund() 增加 fundedTotal，直接 transfer 进来的不计入
- KeyRegistry：没充值时立即生效；有充值时进入排队，期满前 keyOf 仍是 0
- ConfigTimelock：一人签名 queue 失败；期满前 execute 失败；一人 cancel 成功；部署私钥直接调用配置函数失败

### 1.4 部署

- `contracts/script/Deploy.s.sol`：部署全部 v0 合约；3 位人员地址写进构造参数；初始配置在构造时写好（金库登记、代币清单、cap、初始 quota、交易所 A 提交地址）
- forwarder：先跑 `cre workflow supported-chains` 核对 Base Sepolia 的地址，以它为准。文档上的地址：
  - PROD：KeystoneForwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`
  - SIM：MockKeystoneForwarder `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5`
- 方式未定时先部署 SIM 版本；决定方式 A 后重新部署 PROD 版本（mode 是 immutable）
- 输出 `deployments/base-sepolia.json`；packages/shared 从 forge out 生成 ABI 并导出地址
- `scripts/reset-demo`：演示之后恢复干净状态（RequestBoard 保留，它不依赖 Receiver；新 Receiver 的 deployedMinute 让积压检查忽略旧分钟）。只重新部署会被收紧动作改变的合约，以及只认这些合约的合约：QuorumReceiver、热 / 温 QuorumVault、ColdVault、ThreatRegistry、PatrolState、DecoyCommit（后两个在阶段 5、6 才有）；QuorumLens 也重新部署以指向新地址；KeyRegistry、DepositVault、RequestBoard、ConfigTimelock、代币保留，所以账户、钥匙、充值都不用重新种。DepositVault 的钱转到交易所的收款地址（构造时写死，不是金库），金库由脚本另外注资。脚本要自动完成：
  - 写新的 deployments json
  - 重新生成 trap、cosign、patrol 的 config（金库与 Receiver 地址、orgVaults）
  - 方式 A 时重新部署三个 workflow
  - 更新 Ponder 配置里的合约地址与起始区块（新部署区块）；Ponder 可能拒绝沿用旧 build 的 schema（待验证），所以先 drop ponder_quorum 里的表、重跑 grants，再启动重新索引；trap-sync 重新读 traps
  - 新合约在 Basescan 验证

验收：合约在 Basescan 验证源码；地址写进 STATUS.md；`reset-demo` 能在 10 分钟内跑完。

### 1.5 packages/shared

- `encodeReport` / `decodeReport`：覆盖 10_interfaces.md 第 4 节全部 kind
- EIP-712：Withdrawal、KeyBinding、OfficerAction 的类型与 domain
- ID 工具：userIdHash、requestId、txHash、caseId、显示编号、诱饵 tag
- `seal` / `unseal`：ECIES，临时钥匙与 nonce 由 HMAC(K, …) 派生（见 10_interfaces.md 第 4 节）
- 测试：与 forge 共用测试向量；`seal` 同样输入跑两次，密文逐字节相同

### 1.6 CRE 项目与 PING

- `cre init` 在 workflows/ 建项目；trap、cosign、patrol 三个目录（trap、cosign 先放空 handler）
- project.yaml 配 `ethereum-testnet-sepolia-base-1` 的 RPC
- patrol：cron 触发 → 读 Receiver.lastPing → 写只含 PING 的报告 → 检查 `txStatus` 与 `receiverContractExecutionStatus` → 日志
- `cre workflow simulate workflows/patrol --target staging-settings --broadcast`
- `cre workflow limits export` 把模拟器实际套用的配额存成 `verify/cre_limits.json`，记进 STATUS。模拟器预设就套用生产配额；**任何脚本都不许加 `--limits none` 或自订放宽的配额文件**，否则测出来的吞吐、延迟都不能对外说（D30 的 ST 检查）

验收：cast 读 `lastPing()` 等于这次的 note；indexer 收到 Ping 事件。

### 1.7 风险 spike（结果写进 STATUS.md：可行 / 不可行 / 替代方案）

| # | 验证什么 | 怎么验 | 不行的话 |
| --- | --- | --- | --- |
| S1 | 有没有部署权限 | `cre whoami` | 方式 B：SIM 模式 + sim-runner |
| S2 | simulate --broadcast 经 Mock forwarder 写入后 Receiver 状态改变；`receiverContractExecutionStatus` 在成功与 revert 时各是什么值 | 1.6；再故意送一份会 revert 的报告 | 停下来查文档，这是整个项目的前提 |
| S3 | log trigger 能用 `--evm-tx-hash` + `--evm-event-index` 模拟；`--listen` 能不能实时监听 log trigger | 用 MockERC20 发 Transfer，两种都试 | sim-runner 自己用 viem 订阅，再调用 `--evm-tx-hash` |
| S4 | WASM 里 `@noble/hashes` 的 hmac(sha256)、keccak；`@noble/ciphers` AES-GCM；`@noble/curves` secp256k1；shared 的 `seal` 跑两次密文相同 | patrol 里临时加计算，打日志与 shared 测试向量比对 | tag 改 keccak256(salt ‖ 标识)；原因不加密并在 Console 标明 |
| S5 | secrets 在 simulate 里能读；2 KB 上限；每次执行 5 次 getSecret 上限 | secrets.yaml + .env | tag 拆成两个 secret |
| S6 | Base Sepolia 有没有 ETH/USD Price Feed，`callContract` 读得到 | data.chain.link 查地址后读 latestRoundData | 部署 MockV3Aggregator，不换链；只影响阶段 5 |
| S7 | NOWNodes key 可用；是否支持 Base Sepolia、XRP 测试网 | 脚本请求 | XRP 诱饵改 P2，或放主网少量 XRP |
| S9 | EVM read 与 filterLogs 的实际回复上限；patrolView（两个 org、含 outRing）的回复大小；`callContract` 指定 latest − N（N = 40、150）能否读到 | patrol 里临时加：MockERC20 先转 10、40、100 笔，filterLogs 一次读回，看哪一档开始失败；QuorumLens 指定 latest − 40 读取 | 把能稳定读回的笔数（打 7 折）写成 config `BATCH_LOGS`（初值 40）；读不到旧区块时，诱饵只留 floor 检查（不能把诱饵余额写上链） |
| S10 | CRE 超过 log trigger 限流时，多出来的事件是丢掉还是排队？排队的话延迟多久？ | 方式 A：用一个额度桶调高的测试 RequestBoard，6 秒内送 15 笔请求，看几笔有裁决、各隔多久；方式 B 跳过（sim-runner 自己订阅，不受这个限流） | 不论哪种，都靠 resubmit 与积压检查兜底（10_interfaces.md 3.1）；结论写 STATUS |
| S8 | （方式 A 才需要）部署后的 workflow 配置，外人能不能读到？诱饵地址写在 trap 的配置里 | 用另一个 CRE 账号查 | 诱饵地址改放 secret；代币诱饵改由 Patrol 的 decoys handler 查余额（和原生币诱饵同一套，PATROL_DECOYS），触发延迟变成约 60 秒。不改成「监听整个代币合约」：那样每笔正常提款都会占 Trap 的 log trigger 额度 |

### 1.8 种子数据

按 20_data.md 第 4 节步骤 1 到 6 与 8（诱饵钱包是阶段 2 的事）：

- `datasets/gen-accounts`、`decoy-admin accounts`、`datasets/gen-keys`、`datasets/seed-chain`
- 先在 Anvil 上跑通，再上 Base Sepolia

验收：
- 全部账户都有登记的钥匙；链上 depositedOf 等于后台 balances；deposits_ledger 的 tx_hash 都查得到
- 在 exchange_a 里，没有任何字段能区分诱饵账户和普通账户

### 1.9 indexer（Ponder）骨架

- services/indexer：Ponder 0.17.x；`ponder.config.ts` 从 deployments json 读我方合约地址与起始区块；`ponder.schema.ts` 定义 20_data.md 3.2b 的 chain_events、cases
- 连接：`DATABASE_URL` 用 `ponder_svc` 的直连或 session 模式（5432）；`DATABASE_SCHEMA=ponder_quorum`；不设 views schema
- Ponder 自带的 HTTP 服务：不挂 `/sql`（@ponder/client）与 GraphQL；只留 `/health`、`/status`，而且只在内网可达。Console 一律经自己的服务端路由查数据库
- RPC：NOWNodes 为主，另一个服务商备用（Ponder 支持多个 transport）
- 重组、补抓由 Ponder 处理，不自己写
- 只索引我方合约的事件，不碰 traps；trap-sync 在阶段 2 才建

验收：PING 事件 30 秒内出现在 ponder_quorum.chain_events；停掉 indexer 10 分钟再启动，中间的事件都补上。

### 1.10 验证框架骨架

按 40_verification.md：

- packages/verify：检查注册表 + `pnpm verify:design`，输出 reports/design-conformance.md / .json
- workflow 单元测试（WU）骨架：workflows/*/src/logic/ 放纯函数，workflows/*/test/ 用 bun test 与 mock 的 Reads
- `verify/access_manifest.json` 与比对脚本（4.2）
- 字节码扫描（D17）：反汇编时跳过 PUSH 数据和结尾的 CBOR metadata
- workflow lint 规则（D30、D10）：禁用 API、EVM read 必须显式指定区块号
- forge invariant 的 handler 骨架与 I1、I2、I3、I6、I7（其余随功能补）
- DET 脚本：patrol 的 PING 跑两次比对
- CI：GitHub Actions 跑 U、INV、ST、DB

### 1.11 本地一键启动

- `pnpm dev`：并行启动 exchange-api（健康检查）、indexer（Ponder）、user-app 与 console（空页面）
- README：先 `supabase start`，再 `pnpm dev`；CRE 怎么跑

## 设计一致性（必须通过，见 40_verification.md）

D11、D16（合约部分）、D17、D19、D20、D28（数据库部分）、D29（数据库部分）、D30

## 阶段 1 完成标准

- [ ] forge 测试全过；shared 测试全过；两边测试向量一致
- [ ] 合约在 Base Sepolia 部署并验证源码；`reset-demo` 可用，而且不需要重新种账户
- [ ] PING 报告经 CRE 写上链，`lastPing` 改变，indexer 收到
- [ ] S1 到 S7、S9、S10 有结论（S8 视方式而定），已决定方式 A 或 B；pg_partman 查询结果记进 STATUS
- [ ] Supabase 权限测试全过
- [ ] 种子数据验收全过
- [ ] `pnpm verify:design --phase 1` 全过；独立审查（REV）没有未处理的 High
- [ ] STATUS.md 更新
