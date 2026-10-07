# Track slides: Chainlink CRE, NOWNodes, Solana (content only)

Status: draft, 2026-10-07, checked against token2049/main 637d7b2 (Solana Guard live on devnet, docs/SUBMISSION.md).
One section per track, three slides each, written against that track's judging criteria.
Slide text is in English (what goes on screen); 讲者备注 is in Chinese. No em dash.

Every number carries its source (CLAUDE.md rule 8):

- `[DON]` testnet, measured on the real Chainlink DON (Base Sepolia, 2026-10-07)
- `[testnet sim]` testnet with real transactions, run through `cre workflow simulate --broadcast` (mock forwarder)
- `[devnet]` Solana devnet, measured (demo/solana-latest-run.json, 2026-10-07)
- `[on-chain]` public on-chain data (replays of real incidents; tx hashes in the repo)
- `[test]` automated tests
- `[assumed]` assumption or model
- `[todo]` not measured yet; fill in after the run, otherwise leave the line off the slide

Sources for every figure: docs/BENCHMARK.md, docs/DEPLOY_BASE_SEPOLIA.md, docs/STATUS.md, docs/AUDIT_2026-10-07.md,
docs/42_performance.md, docs/10_interfaces.md, docs/SUBMISSION.md, reports/don/, analysis/trace_bybit/results/,
solana/README.md, demo/solana-latest-run.json.

---

# A. Chainlink: Best Workflow with CRE

Criteria: Blockchain 40% · Effective use of CRE 40% · Wow factor 20%

## A1. Blockchain (40%): the exchange backend can lie, the chain decides

**Title:** The kill switch for withdrawals should not live on the server that gets hacked.

**Problem**
- Five exchange heists in 2024 to 2026, about USD 2.4B in total, all started with the attacker scouting the hot wallets first `[on-chain]`
- Alerts that run inside the exchange's own backend can be switched off by whoever controls that backend

**What Qu3ee changes**
- The exchange backend can only submit withdrawal requests. Whether money moves is decided by a Chainlink DON and enforced by contracts
- Vaults only transfer, and only against a DON-signed APPROVE. No delegatecall, no upgrade path
- No owner backdoor: the receiver accepts reports only from the Chainlink forwarder; forwarder, mode and org are immutable; the deploy key has no power after deploy
- Every config change goes through a two-officer timelock (24 h in production, 600 s on testnet). There is no "reset quota" function to call
- Decoys are planted inside the exchange and known only to the DON (CRE secrets). The backend cannot see which wallets are traps, so it cannot avoid or disarm them

**Why this is good for Web3, not only for one exchange**
- A shared on-chain ThreatRegistry: when an attacker touches a decoy at one exchange, every member exchange sees that address
- Proven on the DON: the Trap fired on exchange B, and exchange A's Cosign then held an honest withdrawal for 578 s while the threat was active `[DON]`
- Users sign their own withdrawal with a registered key; the DON checks that signature, so a backend cannot invent a withdrawal

**Footer (small):** Base Sepolia, PROD mode, real KeystoneForwarder `0xF834…4482`. ThreatRegistry `0x602C…3fE5`, RequestBoard `0x6b41…47df`.

讲者备注：
- 这页的核心一句：「后台说了谎，钱也走不了」。不要说「防住所有攻击」
- 「每个成员交易所都看到」要加限定：碰到诱饵钱包或诱饵账户才会写入共享名单（诱饵收款地址与原生币诱饵只在本地收紧）
- 578 秒那个数是一次运行；问到就说「单次实测」

## A2. Effective use of CRE (40%): three workflows, one DON, every capability doing real work

**Title:** Detection, prevention and reconciliation all run as CRE workflows on the DON.

| Workflow | Trigger | What it decides | On-chain effect | Measured on the DON |
| --- | --- | --- | --- | --- |
| **Trap** | EVM log trigger: a transfer out of a decoy | Re-reads the receipt (the log must really exist); asks NOWNodes as a second witness with identical consensus across nodes | Freeze warm vault, hot quota to 0, alert CONFIRMED, cold delay 72 h, attacker to ThreatRegistry | **Decoy touch to on-chain freeze in 10 s** (5 blocks) `[DON]` |
| **Cosign** | EVM log trigger: every withdrawal request | Seven gates (txHash integrity, operation allowlist, user signature, decoy and shared list, deposit cap, data agreement and price freshness, hidden cap x risk) plus a sequential risk score | SCORE + VERDICT with a `notBefore`; the vault pays only against APPROVE | **Request to verdict in 18 s** (9 blocks), then paid `[DON]` |
| **Patrol** | 5 cron handlers + 1 HTTP handler | Reconciles reserves, refills quotas, watches native-coin decoys, keeps a CUSUM checkpoint | Quota refills, checkpoints, derived threats | **52 of 52 reports accepted**, from 7 node addresses; tick to on-chain report 18 s median, 24 s p90 `[DON]` |

**Built for consensus, not just run on it**
- Deterministic by construction: all times come from block headers; cron reads pin one anchor block (latest minus 5); amounts are integers; the "random" ECIES key and nonce are HMAC-derived, so every node seals the same ciphertext
- Tighten fast, loosen carefully: freezes act on LATEST; refills need both LATEST and FINALIZED to be clean, and the contract refuses refills during an alert
- Idempotent: a VERDICT is written once; threats are deduplicated by evidence; the same event processed twice gives a byte-identical report `[test]`
- Within the CRE read budget: one QuorumLens call returns all the chain state a decision needs
- Secrets do real work: the decoy key material lives only in CRE secrets; Cosign matches HMAC tags, never addresses

**Proof:** 146 contract tests and 5 invariants over 262,144 calls `[test]`. Gas about 218,000 per Patrol report `[DON]`. DON transactions: Cosign request `0x1043…ac43`, verdict `0x1f13…8b52`, payment `0x23cb…924f`; Patrol report `0x554b…20ec`.

讲者备注：
- 10 秒、18 秒都是单次运行（BENCHMARK.md）。说「measured once on the DON」，不要说「always」
- Base Sepolia 上 DON 部署的 Trap 只有一个测试诱饵，没有 NOWNodes 第二来源（NOWNodes 的 key 访问不了 Base Sepolia）。NOWNodes 见证是在 Ethereum Sepolia 用 simulate --broadcast 跑通的
- Gate 6 的「多数据源一致」目前豁免，只跑价格新鲜度；被问到七关就照实说
- Base Sepolia 的 Trap 冻结报告 `0x32ab0635…` 与探针 `0x236778f2…` 团队已在 docs/SUBMISSION.md 公开。STATUS 提醒：被触发过的诱饵可由 suspect 地址反查，下次演示前要轮换诱饵

## A3. Wow factor (20%): touch a decoy, ten seconds later the money cannot leave

**Title:** The attacker owns the backend. They still cannot withdraw.

**Live demo (one button, real chain)**
1. The attacker has full backend access and scans the hot wallets
2. A probe touches a decoy: the CRE tower lights up, NOWNodes confirms the transaction
3. The hornet is caged: warm vault frozen, hot quota 0, alert CONFIRMED, attacker shared with every member
4. The map follows the stolen trail and shows the funds held in the temporary-lane reserve
5. The exchange's admin alone cannot undo any of it: lowering the alert takes two of three officers

**Why speed matters**
- If the flag lands within 60 s, 94.7% of the flagged wallets still hold the money `[on-chain]` (replay)
- From one known Bybit attacker address, our tracer recovered all 51 FBI-listed wallets within 3 hops `[on-chain]`; the FBI list came out 5 days later

**One DON verdict, enforced on another chain**
- The DON's Trap report on Base Sepolia contained a Token-2022 asset on Solana devnet: the same transfer that worked before was rejected on chain after `[devnet]`
- Next: CRE Solana Write, so the DON writes to Solana directly instead of through a key `[todo]`

讲者备注：
- 现场演示在本地 fork 上跑（真实合约与真实 CRE workflow，CLI simulate）。台上要说「local fork of Base Sepolia」；DON 实测数字用上一页
- Solana 那条已在 devnet 跑通（交易见 C 节）；但目前是 Guard 的 authority 钥匙把 DON 报告带过去，不是 CRE 直接写 Solana。说「the DON's report」，不要说「CRE writes to Solana」
- Cardano 不参赛（docs/SUBMISSION.md），台上不提
- 94.7% 与 51/51 是公开数据回放（不是实时归因），说「replay」
- 地图上的追踪动画与跨链结尾是示意；实测的追踪结果是回放数字，不要说「演示里的追踪是实时的」

---

# B. NOWNodes

Criteria: Quality and completeness 25% · Use of NOWNodes infrastructure 25% · Real-world usefulness 20% ·
Technical creativity 15% · Scalability 15%

## B1. Use of NOWNodes (25%) + Technical creativity (15%): the second witness and the multichain eye

**Title:** We do not freeze an exchange on one node's word. NOWNodes is the second witness.

**Inside the security decision (CRE Trap)**
- When a decoy is touched, every DON node independently fetches the transaction receipt from NOWNodes and reduces it to a canonical form, so all nodes agree byte for byte (identical consensus)
- If NOWNodes contradicts the trigger log, the Trap takes no action: a forged event cannot freeze an exchange (rejected in our audit)
- One NOWNodes call per decoy touch; p50 0.29 s, p95 0.71 s (n = 15) `[testnet sim]`
- On Ethereum Sepolia: NOWNodes confirmed the decoy transfer (`status=1 logs=1`), the Trap tripped, alert went to 4, hot quota 5,000 qUSD to 0, warm vault frozen. Report tx `0x8a16e65f…b5e5` `[testnet sim]`

**Multichain archive data for forensics (Bitget 2026-09-24 replay)**
- One provider, five EVM chains: Arbitrum, Optimism, Base, BSC, and Avalanche attempted
- Finds every transaction of an address without an indexer: bisect the nonce over historical `eth_getTransactionCount`, then `eth_getBlockByNumber` (full), receipts, `eth_getCode` (EIP-7702 aware) and `eth_call`
- Decodes Across `FundsDeposited` and Stargate `OFTSent` deposits into cross-chain edges: **65 bridge edges, USD 18.5M** `[on-chain]`
- 2,671 cached RPC calls for the whole replay, about 21 per transaction; two runs produce the same hash `[on-chain]`

讲者备注：
- 准确说法：NOWNodes 见证在 Ethereum Sepolia 用 CRE simulate --broadcast 跑通（真实测试网交易）。DON 上部署的 Trap 在 Base Sepolia，那里没有 NOWNodes（key 没有 Base Sepolia 权限）
- Bybit 51/51 与 Stake 4/4 用的是 Etherscan 与公共 RPC，不是 NOWNodes。这页只讲 Bitget 跨链
- 不要引用地图里「trace reads the chain through NOWNodes RPC (eth_getLogs per block)」那句注释，fork 上的追踪读的是本地 anvil

## B2. Quality and completeness (25%) + Real-world usefulness (20%)

**Title:** Exchange drains are scouted first. We catch the scout and follow the money across chains.

**The real problem**
- Bitget, 2026-09-24: test transfer 18:31:11, first large theft 18:58:59 UTC, the exchange noticed at 19:05 `[on-chain]`
- Attackers bridge out within minutes; a tracer that only sees Ethereum loses the trail

**What works end to end today**
- Decoy touch, NOWNodes witness, CRE verdict, on-chain freeze, shared threat list, tracing
- With NOWNodes multichain data, Bitget recall rose from **8 of 14** known attacker wallets (Ethereum only) to **12 of 14** (85.7%) `[on-chain]`
- NOWNodes logic in the Trap: 6 of 6 tests pass; a forged amount is rejected `[test]`

**Who uses it**
- Exchange security on-call teams: the Observatory shows the decoy hit, the CRE verdict, the NOWNodes check and the traced wallets with evidence tx for each link
- Custodians and other exchanges: confirmed addresses land on the shared ThreatRegistry, so every member holds withdrawals to them

讲者备注：
- 「12/14」来自 open PR #4 的跨链结果（BENCHMARK.md 注明），被问到就说「cross-chain replay」
- Bitget 的 18:31 测试转账来自真实热钱包，不是诱饵。只能说「如果攻击者先碰到诱饵」
- 还漏 2/14：Mayan、CCTP、intent 类桥没有解码，合约发起的转账没跟

## B3. Scalability and further development (15%)

**Title:** Adding a chain is adding an endpoint.

**Scales by design**
- The Trap picks its NOWNodes endpoint by chain id: a new EVM chain is one entry in that map, using the same CRE secret
- Cost follows attacks, not traffic: one NOWNodes call per decoy touch per node `[assumed]` (design budget); tracing calls are cached and deterministic
- The tracer already speaks to five chains through one provider; the same code path covers any EVM chain NOWNodes serves

**Next with NOWNodes**
- Cosign gate 6: a second deposit source from NOWNodes, so a lying exchange database cannot inflate a user's deposits
- The indexer on NOWNodes (already configured with fallback)
- Privacy: query whole blocks (`eth_getBlockReceipts`) instead of single decoy transactions, so no RPC log can reveal which wallets are decoys
- Beyond EVM: Bitget's largest single-chain loss was on XRP `[on-chain]`; decoys and witnesses there are the next step

**Limits we measured**
- Our key has no access to Base Sepolia, so the DON-deployed Trap runs without the second witness there
- Avalanche: archive state missing (`missing trie node`), so the replay skipped it
- A local fork's transactions are invisible to any public node; the demo labels this honestly

讲者备注：
- 「Next」那几条都还没做，台上用「next」而不是「supports」
- 被问到「NOWNodes 挂了怎么办」：现在照样收紧（用 CRE 自己的 receipt）；挂了就抛出重试是团队待决定事项

---

# C. Solana: Best Use of Solana

Criteria: Technical execution on Solana 30% · Innovation 20% · Product and UX 20% · Real-world impact 15% ·
Demo and presentation 15%

## C1. Technical execution (30%) + Innovation (20%): the rule lives in the transfer itself

**Title:** A threat the Chainlink DON confirmed on Base makes the same transfer fail on Solana.

**Core logic on chain, not a dashboard**
- `qu3ee_guard`: an Anchor program that is the Token-2022 transfer hook of `qUSD-S`, live on devnet `[devnet]`
- Every transfer of the mint calls the hook, which reads the mint's Guard PDA (`["guard", mint]`): NORMAL lets it through, CONTAINED fails the transfer on chain (`Contained`, custom error 6000)
- The hook makes no external calls and runs no tracing. It enforces a decision the Chainlink DON already made

**Rules the program enforces**
- Only the Guard's authority changes its state
- The same case applied twice leaves the same state; evidence older than what the Guard holds (by EVM block number) is refused, so a stale report cannot reopen a mint
- One Guard per org and mint: org A's containment never touches org B's asset; other mints are unaffected
- The mint must name this program as its transfer hook before a Guard can be created, and only the mint authority can create it
- Inside a transfer, the hook checks that both token accounts are mid-transfer and that the extra accounts are exactly the ones its list names: leaving out the Guard, swapping in another Guard, or calling the hook outside a transfer all fail
- 16 tests on a local validator, S01 to S08 plus hook wiring and no-bypass `[test]`

**Cross-chain evidence**
- The Guard carries the source of its containment: the DON's Trap report on Base Sepolia `0x32ab0635…`, block 47,802,234 `[DON]`
- Before applying it, the demo checks that report on Base: the KeystoneForwarder accepted it and the Receiver logged FREEZE and THREAT

**Innovation**
- Transfer hooks are usually allowlists. Here the hook enforces a security verdict that a Chainlink DON reached on another chain
- Next: CRE Solana Write, so the DON's report lands through the Solana keystone forwarder and the Guard's authority becomes the DON itself `[todo]`

讲者备注：
- 现在是「Guard 的 authority 钥匙在 Base 上核对 DON 报告后，把威胁带到 Solana」。CRE 直接写 Solana（on_report 指令）还没写，只说「next」
- 链上没有 CONFIRMED / LINKED 分类检查（ThreatReport 只有 case hash、来源链、证据交易、区块号）。不要说「LINKED 在链上被拒」
- mint 的 hook authority 在这次运行里没有移除。不要说「没人能把 hook 换掉」；被问到就说这是上线前要做的一步
- 不要说可以套在现有 USDC 上：qUSD-S 是新发行的测试币，带我们的 hook

## C2. Product and UX (20%) + Real-world impact (15%)

**Title:** Holders do nothing. Issuers get a circuit breaker that a hacked server cannot turn off.

**User experience**
- Holders send `qUSD-S` like any Token-2022 token; the client resolves the hook's extra account (the Guard) from the on-chain list
- When the Guard is CONTAINED the transfer fails with a readable reason: "Qu3ee guard is CONTAINED: transfer rejected"
- A public evidence page shows every transaction of the run, each with an explorer link: https://dist-two-gamma-80.vercel.app
- A reviewer runs it alone: `pnpm solana:test`, `pnpm solana:demo`

**Who needs this**
- Stablecoin issuers and treasuries minting Token-2022 assets
- Custodians and payment processors holding customer funds on Solana
- Autonomous agents that hold money: a confirmed compromise freezes what they can move

**Path after the hackathon**
- Issuers add the hook when they create a mint
- Exchanges in the Qu3ee network share one threat list on the EVM side; the Guard turns a confirmed threat into enforcement on Solana
- Reset is deliberate: only the Guard's authority returns a mint to NORMAL, and only with evidence at least as new as what it holds

讲者备注：
- 影响面讲「新发行的资产」，不要暗示能保护已发行的代币
- devnet 与 Base Sepolia 都没有 NOWNodes 端点，Solana 这边用别的 RPC（README 已写明）

## C3. Demo (15%): the same transfer, before and after

**Title:** Same asset, same sender, same recipient. Success, then rejected on chain.

**Live run (`pnpm solana:demo`, Solana devnet)** `[devnet]`
1. Program `HaJ4J8KhE5FGfBFpgrwkqXk6yXfdjNYJpLjJ71KGrEXz`
2. Mint `qUSD-S` `6D7PygkF5K85JS1Cbkxvz6J4Q7vrY1byCLx47T3w91o6`, Guard for org B, NORMAL
3. Sender sends recipient 10 qUSD-S: **SUCCESS** `2NBywAz9…`
4. Check the DON's Trap report on Base Sepolia (`0x32ab0635…`, block 47,802,234): accepted by the KeystoneForwarder, FREEZE and THREAT logged
5. Apply it to the Guard: **CONTAINED** `xcKtP7Q4…`
6. The same 10 qUSD-S transfer again: **REJECTED on chain** (`Contained`) `2jhbFKJ9…`

Then open the three transactions in Solana Explorer, or show the evidence page.

讲者备注：
- 第 6 步那笔失败交易也上链了、有 explorer 链接，这是这页最有说服力的一笔
- 所有链接在 docs/SUBMISSION.md 的 Solana 一节，台上点那里最稳
- 如果 CRE Solana Write 赶上了，第 4、5 步改成「Chainlink CRE writes the threat to Solana」并补 DON 交易
