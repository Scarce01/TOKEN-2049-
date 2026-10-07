# Track slides: Chainlink CRE, NOWNodes, Solana

Slide content only (no layout). Three slides per track, each written against that track's judging criteria.
Slide text is English and goes on screen as written; 讲者备注 is Chinese, for the speaker. No em dash.

Source tags are the same as the README Results table (CLAUDE.md rule 8). Every number on a slide carries one:

| Tag | Meaning |
| --- | --- |
| `[testnet (DON)]` | public Base Sepolia, workflows running on the Chainlink DON, real KeystoneForwarder |
| `[testnet]` | public Ethereum Sepolia, `cre workflow simulate --broadcast` |
| `[testnet fork (local)]` | local anvil fork of Base Sepolia driven by the CRE CLI |
| `[testnet fork (hosted)]` | the same fork served at the public Observatory URL |
| `[testnet (Solana devnet)]` | the Qu3ee Guard program on Solana devnet |
| `[on-chain]` | public chain data, replays of real incidents |
| `[test]` | automated tests |
| `[assumed]` | simulation or assumed parameters |

Where the numbers come from: README Results, docs/BENCHMARK.md, docs/DEPLOY_BASE_SEPOLIA.md, docs/SUBMISSION.md,
docs/STATUS.md, docs/AUDIT_2026-10-07.md, reports/don/, analysis/trace_bybit/results/, solana/README.md,
demo/solana-latest-run.json. Checked against token2049/main on 2026-10-07.

---

# A. Chainlink: Best Workflow with CRE

Judged on: Blockchain 40% · Effective use of CRE 40% · Wow factor 20%

## A1. Blockchain (40%)

**Title:** The kill switch for withdrawals should not live on the server that gets hacked.

**The problem**
- Five exchange heists in 2024 to 2026, about USD 2.4B, all began with the attacker scouting the hot wallets `[on-chain]`
- Bitget, 2026-09-24: test transfer 18:31, first large theft 18:58, the exchange noticed at 19:05 `[on-chain]`
- Controls that run inside the exchange's own backend can be switched off by whoever controls that backend

**What moves on chain**
- The backend can only submit withdrawal requests. A Chainlink DON decides; contracts enforce
- Vaults only transfer, and only against a DON-signed APPROVE. No delegatecall, no upgrade path
- No owner backdoor: the receiver accepts reports only from the Chainlink forwarder; forwarder, mode and org are immutable; the deploy key has no power after deploy
- Every config change needs two officers and a timelock (24 h in production). There is no "reset quota" function
- Decoys are known only to the DON (CRE secrets): the backend cannot tell which wallets are traps
- Users sign their own withdrawals with a registered key, so a backend cannot invent one

**Value beyond one exchange**
- One ThreatRegistry for every member: a decoy touch at one exchange puts the attacker's address in front of all of them
- On the DON: the Trap fired at exchange B, and exchange A's Cosign held an honest withdrawal for 578 s, then paid it `[testnet (DON)]`
- The same containment also fails a token transfer on Solana (section C)

**Footer:** Base Sepolia, PROD contracts, KeystoneForwarder `0xF834…4482` · ThreatRegistry `0x602C…3fE5` · RequestBoard `0x6b41…47df`

讲者备注：
- 一句话：「后台说了谎，钱也走不了」。不要说「防住所有攻击」
- 「全网都看到」要加限定：碰到诱饵钱包或诱饵账户才写入共享名单；诱饵收款地址与原生币诱饵只在本地收紧
- 578 秒是单次运行

## A2. Effective use of CRE (40%)

**Title:** Detection, prevention and reconciliation all run as CRE workflows on the DON.

| Workflow | Trigger | Decides | Writes on chain | On the DON |
| --- | --- | --- | --- | --- |
| **Trap** | EVM log: a transfer out of a decoy | The receipt really exists; NOWNodes agrees (second source, identical consensus) | Warm vault frozen, hot quota 0, alert CONFIRMED, cold delay 72 h, attacker listed | Decoy touch to freeze in **10 s** (5 blocks) `[testnet (DON)]` |
| **Cosign** | EVM log: every withdrawal request | Seven gates plus a sequential risk score | SCORE and VERDICT with a `notBefore`; the vault pays only on APPROVE | Request to APPROVE in **18 s** (9 blocks), then paid `[testnet (DON)]` |
| **Patrol** | 5 cron handlers + HTTP (verify-edge) | Reconciles reserves, refills quotas, watches native-coin decoys, runs the spike rule | Refills, checkpoints, traced threats | **52 of 52** reports accepted, 7 DON transmitters, tick to block 18 s `[testnet (DON)]` |

**The seven Cosign gates:** txHash integrity · operation allowlist · user signature · decoy and shared list · deposit cap · data agreement and price freshness · hidden cap x risk

**CRE does not trust its own helpers**
- Tracing: Trek proposes the next hop over the HTTP trigger; CRE re-reads each proposed transfer before it lists anyone. 11 of 11 cases, last hop listed 14 s after the transfer `[testnet fork (local)]`
- Spike rule in Patrol (CUSUM + Shewhart) on the Bitget hot wallet: alarm at 18:58, the minute of the first large theft `[on-chain]`

**Built for consensus**
- Deterministic: time from block headers, reads pinned to one anchor block, integer amounts, HMAC-derived keys and nonces so every node seals the same ciphertext
- Tighten on LATEST, loosen only when LATEST and FINALIZED agree
- Idempotent: a verdict is written once, threats are deduplicated by evidence, the same event twice gives byte-identical reports `[test]`
- One QuorumLens call returns all the state a decision needs, inside the CRE read budget

**Proof line:** 146 contract tests incl. 5 invariants over 262,144 calls `[test]` · 84 workflow logic tests `[test]` · prevention 8 of 8 cases with the real CRE CLI `[testnet fork (local)]` · about 218,000 gas per Patrol report `[testnet (DON)]`

讲者备注：
- 10 秒、18 秒都是单次运行；说「measured once on the DON」
- DON 上的 Trap 在 Base Sepolia，只有一个测试诱饵，不调用 NOWNodes（我们的 key 没有 Base Sepolia 端点）。NOWNodes 第二来源是在 Ethereum Sepolia 跑通的
- Gate 6 的「多数据源一致」目前豁免，只跑价格新鲜度
- 尖峰规则默认关闭，由部署配置打开；18:58 是公开数据回放
- 冻结报告 `0x32ab0635…` 与探针 `0x236778f2…` 已在 docs/SUBMISSION.md 公开；被触发过的诱饵能由 suspect 地址反查，下次演示前轮换诱饵

## A3. Wow factor (20%)

**Title:** The attacker owns the backend. Ten seconds after touching a decoy, the money cannot leave.

**The live demo, one button**
1. The attacker, with full backend access, scans the hot wallets and sends probes
2. A probe touches a decoy: the CRE tower lights up, the verification runs
3. Warm vault frozen, hot quota 0, alert CONFIRMED, attacker shared with every member
4. The map follows the stolen trail and shows the funds held in the temporary-lane reserve
5. The exchange admin alone cannot undo any of it: lowering the alert takes two of three officers

**Open it yourself:** the public Observatory with a recorded attack on org A, blocks 47786511 to 47786515 `[testnet fork (hosted)]` https://da2whkz14p08x.cloudfront.net/

**One verdict, two chains**
- The DON's Trap report on Base Sepolia moved a Solana token from NORMAL to CONTAINED: the same transfer that worked before was rejected on chain `[testnet (Solana devnet)]`

**Why ten seconds matters**
- If the flag lands within 60 s, 94.7% of the flagged wallets still hold the money `[on-chain]`
- From one Bybit attacker address, our tracer found all 51 FBI-listed wallets within 3 hops; the FBI list came out 5 days later `[on-chain]`

讲者备注：
- 现场演示跑在 Base Sepolia 的 fork 上（真实合约、真实 CRE workflow、CLI simulate）；DON 的数字用上一页
- 地图上的追踪动画与跨链结尾是示意；实测的追踪数字来自回放与 fork 上的 11/11
- Solana 那条：目前由 Guard 的 authority 钥匙在 Base 上核对 DON 报告后带过去，CRE 直接写 Solana 还没做。说「the DON's report」，不说「CRE writes to Solana」
- Cardano 不参赛（docs/SUBMISSION.md），台上不提

---

# B. NOWNodes

Judged on: Quality and completeness 25% · Use of NOWNodes infrastructure 25% · Real-world usefulness 20% ·
Technical creativity 15% · Scalability and further development 15%

## B1. Use of NOWNodes (25%) + Technical creativity (15%)

**Title:** We do not freeze an exchange on one node's word. NOWNodes is the second witness.

**Inside the security decision (CRE Trap)**
- Before any confirmed tightening, every DON node re-reads the decoy transaction's receipt from NOWNodes
- Each node canonicalizes the receipt (sorted logs, integer status) so all nodes agree byte for byte
- A receipt that contradicts the trigger log stops the report: a forged event cannot freeze an exchange
- An unavailable NOWNodes response does not veto: a dead second source cannot block a real hit
- One receipt call per decoy touch; p50 0.29 s, p95 0.71 s `[testnet]`
- Ethereum Sepolia run: NOWNodes confirmed the log, the Trap tripped, hot quota 5,000 qUSD to 0, warm vault frozen; a later APPROVE reverted with `AlertConfirmed` `[testnet]`

**Multichain archive data for forensics (Bitget 2026-09-24)**
- One key, five origin chains: Arbitrum, Optimism, Base, BSC, Avalanche C-Chain
- Every transaction of an address without an indexer: bisect the nonce over historical `eth_getTransactionCount`, then full blocks, receipts, `eth_getCode` (EIP-7702 aware) and `eth_call`
- Across and Stargate deposits decoded into cross-chain edges: **65 edges, USD 18.5M** `[on-chain]`
- 2,671 cached calls for the whole replay, about 21 per transaction; two runs give the same hash `[on-chain]`

讲者备注：
- NOWNodes 第二来源在 Ethereum Sepolia（`eth-sepolia.nownodes.io`）跑通；Base Sepolia、公开 fork、Solana devnet 都不调用 NOWNodes
- Bybit 51/51 与 Stake 4/4 用的是 Etherscan 与公共 RPC，不是 NOWNodes；这页只讲 Bitget 跨链。Bitget 回测里以太坊一侧也是 Etherscan
- 不要引用地图代码里「trace reads the chain through NOWNodes RPC」那句注释，fork 上的追踪读的是本地 anvil

## B2. Quality and completeness (25%) + Real-world usefulness (20%)

**Title:** Exchange drains are scouted first. We catch the scout and follow the money across chains.

**Works end to end**
- Decoy touch, CRE verdict with the NOWNodes witness, on-chain freeze, shared threat list, tracing
- NOWNodes logic in the Trap: 6 of 6 tests; a forged amount is rejected `[test]`
- The Trap flow also runs on the DON (Base Sepolia, 10 s to freeze, without the second source there) and on the public fork Observatory `[testnet (DON)]` `[testnet fork (hosted)]`

**What the multichain data adds**
- Bitget: Ethereum alone finds **8 of 14** known attacker wallets; with NOWNodes on the origin chains, **12 of 14** (85.7%) `[on-chain]`
- Attackers bridge out within minutes; a tracer that only sees Ethereum loses the trail

**Who it is for**
- Exchange security on-call teams: the Observatory shows the decoy hit, the verdict, the second-source check and the traced wallets, each link with its evidence transaction
- Custodians and other exchanges: confirmed addresses go on the shared ThreatRegistry, so every member holds withdrawals to them

讲者备注：
- 12/14 来自 Across 与 Stargate 解码；还漏 2/14：intent 类、CCTP、Mayan 没解码，合约发起的转账没跟
- Bitget 18:31 的测试转账来自真实热钱包，不是诱饵；只能说「如果攻击者先碰到诱饵」
- 和主赛道一样的限制：还没有正式交易所在跑

## B3. Scalability and further development (15%)

**Title:** Adding a chain is adding a URL.

**Scales by design**
- A new chain is a new URL in `NOWNODES_URL`, not a new workflow; the Trap picks the endpoint by chain id
- Cost follows attacks, not traffic: one receipt call per decoy touch, per DON node
- The tracer already reads five chains through one provider; any EVM chain NOWNodes serves uses the same code

**Next with NOWNodes**
- Cosign gate 6: a second deposit source, so a lying exchange database cannot inflate a user's deposits
- Read whole blocks (`eth_getBlockReceipts`) instead of single decoy transactions, so no RPC log reveals which wallets are decoys
- The indexer on NOWNodes (already configured, with fallback)
- Beyond EVM: Bitget's largest single-chain loss was on XRP `[on-chain]`

**Limits we measured**
- No NOWNodes endpoint for Base Sepolia on our key, so the DON-deployed Trap runs without the second witness there
- Avalanche: archive state missing (`missing trie node`), so the replay skipped it
- A local fork's transactions are invisible to any public node; the demo labels this

讲者备注：
- 「Next」那几条都还没做；台上说「next」，不说「supports」
- 被问到「NOWNodes 挂了怎么办」：照样收紧（用 CRE 自己读到的 receipt）；挂了是否改成抛出重试，是团队待决定事项

---

# C. Solana: Best Use of Solana

Judged on: Technical execution on Solana 30% · Innovation and originality 20% · Product and user experience 20% ·
Real-world impact and viability 15% · Demo and presentation 15%

## C1. Technical execution (30%) + Innovation (20%)

**Title:** A threat the Chainlink DON confirmed on Base makes the same transfer fail on Solana.

**Core logic on chain**
- `qu3ee_guard`: an Anchor program that is the Token-2022 transfer hook of `qUSD-S`, deployed on devnet `[testnet (Solana devnet)]`
- Every transfer of the mint calls the hook, which reads the mint's Guard PDA (`["guard", mint]`): NORMAL lets it through, CONTAINED fails the transfer on chain (`Contained`, custom error 6000)
- The hook makes no external calls and runs no tracing: it enforces a decision the DON already made

**Rules the program enforces**
- Only the Guard's authority changes its state
- The same case twice leaves the same state; evidence older than what the Guard holds (by EVM block) is refused, so a stale report cannot reopen a mint
- One Guard per org and mint: org A's containment never touches org B; other mints are unaffected
- Only the mint authority can create a Guard, and only for a mint that names this program as its hook
- Inside a transfer the hook checks both token accounts are mid-transfer and the extra accounts are exactly the listed ones: leaving out the Guard, swapping in another, or calling the hook outside a transfer all fail
- 16 of 16 program tests on a local validator (S01 to S08, hook wiring, no bypass) `[test]`

**Evidence from another chain**
- The Guard holds the source of its containment: the DON's Trap report on Base Sepolia, block 47,802,234 `[testnet (DON)]`
- Before applying it, the run checked that report on Base: the KeystoneForwarder accepted it and the Receiver logged FREEZE and THREAT

**Innovation**
- Transfer hooks are usually allowlists. This one enforces a security verdict that a Chainlink DON reached on another chain

讲者备注：
- 现在是 Guard 的 authority 钥匙在 Base 上核对 DON 报告，再把威胁带到 Solana。CRE 直接写 Solana 需要 receiver 指令，还没写，只说「next」
- 链上没有 CONFIRMED / LINKED 分类检查（ThreatReport 只有 case、来源链、证据交易、区块号），不要说「LINKED 在链上被拒」
- 这次运行没有移除 mint 的 hook authority，不要说「没人能把 hook 换掉」
- 不要说能套在现有 USDC 上：qUSD-S 是新发行的测试币

## C2. Product and user experience (20%) + Real-world impact (15%)

**Title:** Holders do nothing. Issuers get a circuit breaker that a hacked server cannot turn off.

**Experience**
- Holders send `qUSD-S` like any Token-2022 token; the client resolves the Guard account from the on-chain list
- When contained, the transfer fails with a readable reason: "Qu3ee guard is CONTAINED: transfer rejected"
- Judges see every transaction of the run, each with an explorer link: https://qu3ee-solana-proof.vercel.app
- The program runs alone: `pnpm solana:test`

**Who needs it**
- Stablecoin issuers and treasuries minting Token-2022 assets
- Custodians and payment processors holding customer funds on Solana
- Agents that hold money: a confirmed compromise freezes what they can move

**Path to users**
- Issuers add the hook when they create a mint
- Exchanges in the Qu3ee network already share one threat list; the Guard turns a confirmed threat into enforcement on Solana
- Production step: the Guard's authority becomes the DON itself (CRE Solana Write), not a key
- Reset is deliberate: only the authority, and only with evidence at least as new as what the Guard holds

讲者备注：
- 没有 wallet-connect 流程；面向评审的是证据页与 explorer 链接，照实说
- 影响面讲「新发行的资产」
- 重跑 `pnpm solana:demo` 需要 secrets/solana/ 里的 devnet 钥匙；已记录的运行不需要

## C3. Demo and presentation (15%)

**Title:** Same asset, same sender, same recipient. Success, then rejected on chain.

**The recorded devnet run** `[testnet (Solana devnet)]`
1. Program `HaJ4J8KhE5FGfBFpgrwkqXk6yXfdjNYJpLjJ71KGrEXz`
2. Mint `qUSD-S` `6D7PygkF5K85JS1Cbkxvz6J4Q7vrY1byCLx47T3w91o6`, Guard for org B: NORMAL
3. Sender pays recipient 10 qUSD-S: **SUCCESS** `2NBywAz9…`
4. The DON's Trap report on Base Sepolia (block 47,802,234) is checked: accepted by the KeystoneForwarder, FREEZE and THREAT logged
5. The Guard moves to **CONTAINED** `xcKtP7Q4…`
6. The same 10 qUSD-S transfer: **REJECTED on chain** (`Contained`) `2jhbFKJ9…`

Open the three transactions in Solana Explorer, or the evidence page.

讲者备注：
- 第 6 步那笔失败的交易也上链了、有 explorer 链接，是这页最有说服力的一笔
- 链接全在 docs/SUBMISSION.md 的 Solana 一节，台上点那里最稳
- 还缺演示视频链接（README「Still to add」）
