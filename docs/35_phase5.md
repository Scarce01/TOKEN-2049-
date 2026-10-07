# 阶段 5：算法 P1（与阶段 4 并行，第 17 到 22 小时）

## 目标

把 proposal 第 6 节的 A、B、C、D、E 落地，补上关 5（美元）、关 6、关 7：
- 诱饵事先承诺可验证（C）
- 隐藏门槛每期轮换且事后可验证（D）
- 弱信号累积成静默分级（E）
- 命中概率（A）和诱饵不可区分性（B）有离线评估结果

## 前提

阶段 3 完成（第 17 小时）。C、D、E 都依赖 S4（WASM 里的 HMAC、AES 可用）；S4 不通过时，见每节的替代方案。

## 任务

### 5.1 C：加盐 Merkle 承诺

- 合约 DecoyCommit（10_interfaces.md 8.2）；ThreatRegistry.add 改为必须带有效证明（阶段 2 写入的旧条目不受影响）
- decoy-admin `commit`：
  1. 对每个诱饵算 salt_i = HMAC(K, "decoy" ‖ i)
  2. 算叶子，补齐到 2^k（假叶子 = 随机 32 字节）
  3. 建树，输出根与每个诱饵的证明
  4. 经 ConfigTimelock 写 setRoot
  5. 把 (i, proof) 写进 trap、cosign 的 config
- Trap、Cosign、Patrol：THREAT 的 proof 字段 = abi.encode(ident, salt, path)；salt 在 workflow 里用 K 现场算
- 测试：
  - 正确证明通过；改一个字节失败
  - 揭示一个叶子后，用其他诱饵的地址加任何 salt 都验证不了（没有盐测不出成员关系）
  - 根里的叶子数固定为 2^k，看不出诱饵有几个

### 5.2 D：隐藏门槛轮换

- Cosign 关 7 用 T_e（10_interfaces.md 8.3），不再用常数
- Patrol 在 epoch 切换后的第一次执行写 THRESHOLD_COMMIT(e) 和 THRESHOLD_REVEAL(e − 1)
- Console 控制等级页显示：本期承诺、上期揭示值与「核对通过」
- 每种代币各一份承诺（THRESHOLD_COMMIT 带 token）；由 patrol 的 `epoch` handler（每小时）写
- 测试：揭示值与承诺不符时 DecoyCommit revert；同一 epoch 的 T_e 两次计算相同；不同 epoch 不同；同一 (epoch, token) 第二次写被忽略

### 5.3 E：SPRT 账户分数

- 合约：DepositVault.firstDepositAt、Receiver.seenRecipient、SCORE action（10_interfaces.md 8.4、8.5）
- Cosign 每笔：
  1. 读加密旧分数并用 K 解密；没有就当 0
  2. 衰减
  3. 加本笔信号的 λ（同类上限）
  4. 算等级，传给关 7
  5. 重新加密，每次都写 SCORE，带 prevHash = keccak256(读到的旧密文)（没有旧分数时为 0）。合约对不上就跳过这份裁决与分数（ScoreConflict），等 resubmit 用新分数重算（10_interfaces.md 第 4 节 kind 9，D64）
- 所有运算 bigint；λ 表、γ^h 表、阈值放 config，标「假设」
- λ 由 P(s|H1) / P(s|H0) 算出时，P(s|H0) 用加一平滑，避免样本少时估成 0 导致分数爆炸；H0 能从链上估的（新收款地址比例、金额分布）在阶段 6 用 BigQuery 数据重估
- sealedReason 带每个信号的 λ 明细，Console 的 Cases 页显示「分数是怎么来的」（D53）
- 定点数与浮点参考实现（Python）比对，误差 ≤ 1 milli-nat（D50）
- 测试（shared 与 workflow 共用向量）：
  - 只有「贴着假门槛」一个信号，分数 4605 → L2
  - 「新账户 + 新地址」两个信号，被同类上限截到 1500 → L0
  - 24 小时后分数按 γ 衰减
  - 同一事件跑两次：密文相同（时间来自区块头，不来自 runtime.now()）
  - 分数不变时密文仍然被重写（不同 requestId → 不同 nonce → 密文不同）
  - 测试工具解密前后两份密文，断言 Λ2 = decay(Λ1) + λ（D23 不只看「密文变了」）

### 5.4 关 5 升级（美元）、关 6、关 7

- 关 5：已批准 + 本笔 ≤ 充值，跨代币用 USD 加总；qUSD = 1，qETH 用 ETH/USD Price Feed（或 MockV3Aggregator）；倍数按 STATUS 的决定
- 关 6：同一区块，用 EVM read 和 NOWNodes 的 eth_call 各读一次 depositedOf；不一致 → PENDING 61；价格 updatedAt 超过 1 小时 → PENDING 62。NOWNodes 不支持 Base Sepolia 时，关 6 只做「价格过期」检查，「数据源一致」这一半在 STATUS「设计变更」记为 waived（不要拿不同链的数据互相比，一定对不上）
- 关 7：按 10_interfaces.md 8.4 的等级规则；贴着假门槛的金额，本身就是 SPRT 信号
- Cosign 读取预算按 10_interfaces.md 第 9 节：headerByNumber 1 + cosignView 1 + NOWNodes 1；在 STATUS 记录实际用量

### 5.5 A：命中概率曲线与攻击者模拟（离线）

- `analysis/hit_probability.py`：
  - 模型二：P_hit = 1 − C(m−d, k) / C(m, k)
  - 模型三：按余额加权
  - 画 d/m 与 k 的曲线，输出 PNG + CSV
- `analysis/adversary_sim.py`：41_evaluation.md 第 3 节的策略 1（随机）、2（大户优先）、4（谨慎型，避开没有生活痕迹的钱包、先小额测试），各 1,000 次以上；输出第一次碰到诱饵前的平均试探次数、命中率；与公式比对（D39）
- 写 metrics（source = assumed，注明是公式与模拟结果，不是实测）
- 用于 pitch，不进 CRE

### 5.6 B：诱饵不可区分性（离线）

- `analysis/decoy_auc.py`：
  - 从 exchange_a 读账户特征：注册天数、活跃度、充提频率、KYC 等级、余额分位、是否有钥匙、链上首次充值时间
  - 标签来自 `secrets/decoys.local.json`；只在本地跑，结果不进仓库
  - 逻辑回归 + 梯度提升；5 折交叉验证 AUC，bootstrap 95% 区间
- 目标：AUC 上界 ≤ 0.65；超过就回到 decoy-admin 调整诱饵生成方式
- 结果写 metrics（source = assumed，因为是合成数据）

## 设计一致性（必须通过）

D05、D12（Merkle 部分）、D14.5 到 D14.7、D15、D21、D22、D23、D28（AUC 部分）、D30、D39、D42、D44、D50、D52、D53、D64

## 完成标准

- [ ] ThreatRegistry 只接受带有效证明的新条目
- [ ] 隐藏门槛每期承诺与揭示可在 Console 核对
- [ ] SPRT 测试向量全过；静默分级对外只有 PENDING
- [ ] 关 5 到 7 生效
- [ ] 红队 `probe-threshold`：用一个充值足够、钥匙正常的账户，提款金额 = 假门槛（5 qETH）× 0.95，同时把这期真门槛设到足够高（测试 config），让关 5、关 7 本身不会拦。预期：
  - PENDING，sealedReason 有 72
  - 测试工具用 K 解密分数，Λ ≥ 4605（L2）
  - 链上 alert 不变、没有 Tightened 事件（D05：强信号只静默，不收紧）
  - 同一账户接着付一笔小额到新地址，也是 PENDING（证明 L2 真的生效，而不是被别的关拦下）
- [ ] 命中概率曲线与诱饵 AUC 有结果
- [ ] `pnpm verify:design --phase 5` 全过

### 补充：误报率（D44）

- `scripts/load-normal --fingerprint`：100 笔合成正常提款（金额按 datasets.synthetic_withdrawals 的分布），统计被判 PENDING 的比例与原因
- 写 metrics `false_pending_rate`（source = assumed，因为是合成流量）
