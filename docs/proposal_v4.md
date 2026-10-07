# Quorum Proposal v4: Traps + CRE Tightening

Oct 4, 2026 · @Xu Zi Yu

The core is two things: plant traps inside the exchange; the moment an attacker touches one, the CRE node network automatically tightens withdrawals, and the backend cannot switch it off. User intent checks, a transfer-only vault, hidden parameters and reconciliation are the prevention layer. They make the whole system complete, but they are not the selling point. This version replaces all previous versions. The competition rules do not allow writing code before the start, so this is only a discussion draft. The algorithm specs for decoys, tightening and tracing are in Section 6.

## 1. One-line pitch and positioning

> Every exchange is a hive. Quorum hides decoy honeypots inside. Touch one, and the guards seal the exits and mark you. Every hive in the network knows your scent.

Every exchange is a hive. Quorum hides fake honeypots inside it. The moment an intruder touches one, the guard bees (CRE nodes) seal the exits at once and leave a scent on him; the whole hive network then recognises him. Even if the backend is already compromised, it cannot switch off this alarm.

|  | Content |
| --- | --- |
| **Core** | Traps (decoy wallets, decoy accounts, decoy thresholds, etc.) + automatic CRE tightening |
| **Prevention layer** | User intent checks, transfer-only vault, hidden and rotating parameters, multi-chain reconciliation |
| **For whom** | Small and mid-sized exchanges, custodians, DAO treasuries, AI agent wallets |
| **Tracks** | Main: Chainlink CRE; secondary: NOWNodes (multi-chain monitoring of decoy wallets, historical replay) |

**Metaphor (used only in the first 15 seconds and the ending of the video; product screens stay a professional console)**

"Honeypot" is already a security term, and the hive metaphor grows naturally out of the industry's own vocabulary. A swarm also chooses its new nest by exactly this mechanism: quorum sensing.

| Hive | Quorum |
| --- | --- |
| Honey | Funds |
| Honey cells at the hive entrance | Hot wallet: drawn on demand, small amounts |
| Mid-level honey stores | Warm wallet: refills the entrance |
| Wax-capped honey | Cold wallet: sealed, rarely touched |
| Fake honeypot | Decoy (trap) |
| Guard bees | CRE nodes: independently check every outflow |
| Alarm pheromone | On-chain shared list: spreads from one hive to the whole network |
| Hornet | Attacker |

**What the "scent" actually is:** the attacker's receiving address + a fingerprint of the probing behaviour + evidence from the transaction that touched the trap. CRE nodes verify it and then write it to the on-chain shared list.

**Name:** keep Quorum. However, the enterprise Ethereum that JPMorgan built and later handed to ConsenSys is also called Quorum, and insiders will make the connection. Alternative: Propolis (bee glue, which bees use to seal gaps in the hive). Not Hive: it is the name of an existing blockchain, and also of a well-known ransomware gang.

## 2. Problem: every major heist starts with reconnaissance

In five thefts from exchanges and platforms between 2024 and 2026, about $2.4 billion was taken in total, and in none of them were private keys stolen. In each case the attackers first spent time working out "what kind of transaction gets approved", then struck in one go.

| Incident | Amount | Reconnaissance and probing | Strike |
| --- | --- | --- | --- |
| Bitget, September 2026 | About $388 million | First sent two test transfers below the risk-control threshold (0.84 ETH, 93 TRX); the forged withdrawals "looked legitimate", which shows the approval rules had already been mapped; reports say the attackers lay in wait for 24 days (not officially confirmed) | Large outflows began 27 minutes later; the reconciliation system took 34 minutes to notice |
| Bybit, February 2025 | About $1.46 billion | On February 4, compromised a Safe developer's computer and watched quietly; on the 18th, deployed the contract in advance; the malicious code activated only for Bybit's addresses | February 21, waiting for a routine cold-to-warm transfer |
| Radiant, October 2024 | About $53 million | First planted malware on signers' computers | Swapped the transaction during a routine signing |
| WazirX, July 2024 | About $235 million | Mapped the gap between what the multisig interface showed and the actual transaction | Signers approved a malicious contract upgrade |
| DMM Bitcoin, May 2024 | About $305 million | Posed as a recruiter on LinkedIn to approach an employee of the wallet software vendor | Tampered with a normal transaction request |

Almost nothing is recovered afterwards: Bybit froze about 3%, Bitget about 0.2%. The source texts are authoritative for these figures; check each one before using it in the video.

## 3. Insights

1. **Reconnaissance always touches something.** Reading config, trying accounts, sending test transfers. The Bitget attackers first sent two test transfers from a hot wallet and only struck at scale 27 minutes later. If anything they touch is a trap, they expose themselves early.
2. **Alerts inside a compromised system get switched off.** The Bitget attackers afterwards deleted the records left by their forged instructions. The reconciliation system took 34 minutes to notice, and what it blocked was user withdrawals; the attackers' instructions kept draining funds until 21:23. Putting alerts inside a compromised system is like asking the thief to call the police on himself.
3. **So a trap has to do two things at once:** the backend does not know which item is a trap, and neither triggering nor response passes through the backend. This is exactly CRE: the list lives in a CRE secret, detection reads on-chain facts directly, and the response is written as an on-chain report.

## 4. Core part one: traps

The more traps there are and the more real they look, the more effective they are. Each one matches something an attacker naturally does during reconnaissance.

| Trap | Where it sits | Why the attacker touches it | Who detects it | Reliability |
| --- | --- | --- | --- | --- |
| **Decoy wallet** | A normal-looking "old hot wallet" in the backend config, holding a small amount of real money, with the same signing permissions as the other hot wallets | Used for a test transfer, or swept up along the way during a batch drain | CRE reads the chain directly: any outflow from this wallet counts | High: an on-chain fact the backend cannot delete |
| **Decoy account** | A fake user with a balance in the backend database | When forging withdrawals or inflating balances, attackers pick accounts with large balances | Cosign gate 4; the list is stored as hashes in a CRE secret | High |
| **Decoy threshold** | A fake threshold written into the backend risk-control config, for example 50 ETH; the real threshold lives in CRE | An attacker who has read the config deliberately keeps amounts just below 50 ETH | Cosign probing fingerprint: ordinary users do not know this number | Medium: a strong signal, not proof |
| **Decoy receiving address** | A few addresses we control in the backend allowlist | The attacker wants to use an allowlisted address to test or to transfer | Any incoming transfer means someone has touched the allowlist | Medium |
| **Decoy credential** | Fake API keys and fake signing-service credentials placed in the backend | The attacker tries them during lateral movement | When one is used, the external service sends a callback, which is forwarded to CRE | Medium: passes through an off-chain relay |

- **The decoy wallet is the core.** Its trigger is an on-chain fact, so deleting backend logs does not help; it can also be placed on any chain, including XRP (read through NOWNodes).
- **The decoy threshold is the part that comes from YT's Veil.** The rule the attacker "infers" from the config is fake, and the behaviour he adopts to avoid it becomes his fingerprint.
- **There is no guarantee every attacker will touch one.** A very careful attacker may avoid them, which is why the prevention layer in Section 7 is needed.

## 5. Core part two: CRE tightening

After a trap fires, the CRE node network verifies the evidence (the on-chain transaction or the request content), reaches consensus and writes a report on-chain; the contracts then execute the tightening directly. The whole path bypasses the exchange backend, so a compromised backend cannot switch it off.

| Level | How it is entered | Tightening action | Can the attacker see it? |
| --- | --- | --- | --- |
| **Confirmed** | A decoy is touched: an outflow from a decoy wallet, or a withdrawal from a decoy account. Normal users almost never touch one, so the likelihood ratio tends to infinity | Hot vault quota set to zero and its balance swept back to the cold wallet; warm vault frozen (time-limited, for example 2 hours; extending needs two officers' signatures); cold wallet timelock lengthened; attacker's receiving address + transaction evidence + decoy commitment proof written to the shared list | Yes: at the Confirmed level, stopping the bleeding comes first |
| **L3** | Account score Λ ≥ ln 900 ≈ 6.80 (Wald threshold) | All withdrawals from this account go to manual review | No: the response is still "processing + reference number" |
| **L2** | Λ ≥ ln 100 ≈ 4.61. An amount just under the decoy threshold reaches this level on that one signal alone | Cooldown on new receiving addresses, large amounts go to manual review; the address is marked "suspicious" | No |
| **L1** | Λ ≥ ln 10 ≈ 2.30. For example, a new account repeatedly lands in "processing" | This account's hidden limit drops and its delay lengthens | No |
| **Pool level** | CUSUM alarm on the hot vault outflow rate | Slow the quota bucket refill rate; no blocking | No |

Only the Confirmed level blocks automatically; L1 to L3 only delay and route to manual review. This follows from the base rate; see Section 6 E.

**Timeline (compared against the Bitget pace):**

1. The attacker sends a test transfer from the decoy wallet.
2. The decoy wallet holds ERC-20 tokens, so a transfer out emits a Transfer event and the CRE log trigger fires immediately; native-coin decoys rely on Patrol, which patrols every 60 seconds.
3. Each node reads the chain independently to verify (tightening acts on the LATEST block and does not wait for FINALIZED), and after consensus writes the report: zero the quota, sweep funds, freeze, mark the address. The target is to finish within one minute; this must be measured. We must also read contract state to confirm it really changed, not just check that the report transaction succeeded.
4. On the day of the Bitget incident, there were 27 minutes between the test transfers and the large outflows. If the test had touched a decoy, those 27 minutes would have been our window. That assumes they touched a decoy, which cannot be guaranteed.

**Alarm propagation (the hive network)**

- Evidence from a Confirmed event (receiving address, transaction hash, behaviour fingerprint hash, the decoy's Merkle proof) is verified by the DON and written to the on-chain ThreatRegistry; the contract verifies the proof before writing. Entries have a validity period (for example 72 hours), and renewal needs new evidence.
- The Cosign of every other exchange in the network reads the same list on every decision: the same receiving address goes to manual review, and a matching behaviour fingerprint adds to the account score. An exchange can choose to follow the alert level upward; by default it only follows up to L1 (Section 6 H).
- **Ratchet:** automatic raises can only come from CRE reports; lowering happens only on expiry, or with two officers' signatures + a timelock. A compromised backend cannot lift it.
- Every additional attack teaches every member of the network to recognise one more attacker: **the more it is attacked, the stronger it gets**. This is also a commercial network effect: the more exchanges join, the safer each one is.
- Limits: the list only marks "suspicious" and is advisory for other exchanges; an attacker who switches to brand-new addresses and techniques will not be recognised; it only works once several exchanges adopt it; stablecoin issuers will not freeze automatically because of the list.

## 6. Algorithm specs (each mapped to a module)

This section writes decoys, tightening and tracing as specs that can be implemented and tested. CRE needs consensus, so everything that runs in a workflow is deterministic integer arithmetic: no local random numbers, no floating point.

| # | Algorithm | Runs where | Input | Output | Priority |
| --- | --- | --- | --- | --- | --- |
| A | Decoy placement and hit probability | Offline planning | Number of accounts, number of decoys, number of attacker probes | How many to place and where; hit probability curve | P1 (chart only) |
| B | Decoy indistinguishability | Offline | Features of real accounts and decoys | Classifier AUC; passes only near 0.5 | P2 |
| C | Salted Merkle commitment and reveal | DecoyCommit contract + Trap | Decoy list, salt for each decoy | On-chain root; only one leaf revealed on trigger | P1 |
| D | HMAC-derived salts and hidden thresholds | CRE secrets | Shared key K, epoch e | Salts, this epoch's threshold, threshold commitment | P1 |
| E | SPRT account score + decay | Cosign | Log-likelihood ratio of each signal | Account score Λ → L1 / L2 / L3 | P1 |
| F | CUSUM outflow rate change | Patrol | Outflow per minute, per asset | Pool-level alarm → lower refill rate | P2 |
| G | Quota bucket + worst-case loss bound | QuorumVault + Patrol | Quota B, cap C, refill rate r | Approve or route to the verification lane; a computable loss bound | P0 |
| H | Alert ratchet and network propagation | QuorumReceiver + ThreatRegistry | Local level, list entries | Effective level; under automatic control it only rises, never falls | P0 local / P1 network |
| I | One-hop taint tracing | Patrol (follows after trigger) | Attacker address | Next-hop addresses and taint ratios | P2 |
| J | Different confirmation levels for tightening and loosening | All three workflows | Block confirmation level | Tighten on LATEST, loosen on FINALIZED | P0 |

### A. How many decoys, and where

The attacker picks k accounts to probe from the top m by balance. We insert d decoy accounts at random into the top m:

```latex
P_{hit} = 1 - \frac{\binom{m-d}{k}}{\binom{m}{k}}
```

- With m = 200, d = 10, k = 20, P\_hit ≈ 66% (computed).
- When the attacker picks weighted by balance, the probability of picking a decoy in one draw is p = W\_D / (W\_R + W\_D), and P\_hit ≈ 1 − (1 − p)^k. Decoy account balances exist only in the backend database, so they can be placed at the top, making p much larger than d/N.
- The ceiling is set by B: balances must not look implausible.
- Theory: ARMOR (randomised placement, used at Los Angeles airport since 2007) and Bayesian Stackelberg honeypot allocation. In 36 hours we do not write a solver; the pitch shows one hit probability curve.

### B. Decoys must be indistinguishable from real ones

- **The standard comes from Honeywords' flatness.** Train a classifier to separate decoys from real accounts using days since registration, activity, deposit and withdrawal frequency, KYC tier and balance percentile; it passes only if AUC is close to 0.5. Decoys are generated by sampling from the feature distribution of real top accounts, not made up by hand. This is done offline and may use AI, because it does not enter CRE's approval consensus.
- **Decoy accounts also need real on-chain deposit history.** DepositVault is public. An attacker who looks up a backend userId can tell that an account with "a large balance but no on-chain deposit ever" is fake. Approach: the exchange really deposits its own money into decoy accounts; the money ends up in the hot vault, so the round trip costs nothing. This is a gap found during this merge.
- **Decoy wallets must really send and receive.** Research on Ethereum honeypots found that careful attackers first send a small amount and check the transaction hash to expose a fake honeypot; Bitget's two test transfers were exactly this move. A script run by the security lead makes regular small transfers from the decoy wallets to leave "signs of life". CRE cannot sign for an ordinary wallet, so this is not done by a workflow.

### C. Proving the decoys were planted in advance (salted Merkle commitment)

- Leaf: leaf\_i = H(H(chainId ‖ decoyId\_i ‖ salt\_i)); the double hash prevents second-preimage attacks. For a wallet, decoyId is its address; for an account, it is userIdHash.
- The tree is padded to a fixed 2^k leaves (empty slots get dummy leaves), and only the root is written to the DecoyCommit contract, so outsiders cannot tell how many decoys there are.
- After a trigger, Trap reveals only that one leaf's salt and proof path (log₂ n hashes); the contract verifies it on-chain before accepting the list entry.
- Why salt is required: without salt, an attacker can compute leaves for suspected addresses himself and compare them, and so recover every decoy.
- Purpose: other exchanges see not "Quorum says he is suspicious" but "this address touched a decoy that was committed in advance". It also proves we did not invent decoys after the fact to freeze normal users.

### D. Consistent across nodes, impossible for outsiders to compute (HMAC)

If CRE nodes each use local random numbers, their results will not match and consensus fails. Use a shared key K stored in a CRE secret for deterministic pseudo-randomness:

- Decoy salt: salt\_i = HMAC(K, "decoy" ‖ i)
- Real threshold for epoch e: T\_e = T\_min + (HMAC(K, "thr" ‖ e) mod (T\_max − T\_min))
- At the start of each epoch, commit c\_e = H(T\_e ‖ nonce\_e) on-chain and reveal it when the epoch ends, proving we did not change the rules mid-epoch.

K is plaintext to node operators; if K leaks, this whole layer fails.

### E. Account score (SPRT), and why weak signals cannot block

```latex
\lambda(s) = \ln \frac{P(s \mid H_1)}{P(s \mid H_0)}, \qquad \Lambda = \sum \lambda(s)
```

H1 is an attacker, H0 is a normal user.

- **The thresholds have statistical meaning:** L1 = ln 10 ≈ 2.30 (likelihood ratio 10:1); L2 = ln 100 ≈ 4.61; L3 = ln 900 ≈ 6.80 (Wald threshold, false positive rate 0.001, false negative rate 0.1); Confirmed = a decoy was touched, likelihood ratio tends to infinity.
- **Example:** about 0.5% of normal withdrawals fall in the band within 10% below the fake threshold, versus about 50% for an attacker who has read the config. λ = ln(0.5 / 0.005) = ln 100, so this one signal alone reaches L2. Both proportions are assumed values, and we say so openly during the competition.
- **Why only decoys can block automatically:** assume the prior share of attackers among accounts is 1 in 100,000. Even with a likelihood ratio of 900, the posterior probability is only about 0.9% (computed). So L1 to L3 can only be low-cost delays and manual review. The levels are derived from the base rate (the base-rate fallacy discussed in Axelsson 2000).
- **Implementation:** λ is stored as an integer in thousandths of a nat; decay is Λ(t) = Λ(t₀)·γ^(t−t₀) with γ = 0.9 per hour, applied at read time by looking up a precomputed integer table, with no scheduled job; signals of the same kind (new account, new address) share a combined cap to avoid double counting.
- **The score cannot be stored on-chain in plaintext.** Anyone can read on-chain state; if attackers can look up their own account's level, "silent" no longer holds. Approach: the score is encrypted and stored in QuorumReceiver (key derived from K, nonce = HMAC(K, requestId), so every node computes the same ciphertext); every verdict rewrites the ciphertext whether or not the score changed, so outsiders cannot see changes. Levels are enforced only in Cosign (gate 7); the vault does not read levels. This is also a gap found during this merge.

### F. Hot wallet outflow rate change (CUSUM)

```latex
S_t = \max(0,\; S_{t-1} + z_t - k), \qquad z_t = \frac{x_t - \mu}{\sigma}, \qquad \text{alarm if } S_t > h
```

- Patrol computes it every 60 seconds for each hot vault and each asset. x\_t is the outflow in that minute, counted in token units, not converted to USD, to avoid depending on prices.
- The baseline μ is an exponentially weighted average (implemented with bit shifts for integer arithmetic); the dispersion σ is a weighted mean absolute deviation.
- Parameters: k = 0.5; with h = 4 there is on average one false alarm about every 168 samples, with h = 5 about every 465 (ARL table, to be verified). At one sample per minute, h = 5 gives a false alarm about every 7.75 hours, so **CUSUM can only trigger soft actions**: lower the quota bucket refill rate, no blocking. h must be tuned on historical data to fewer than one false alarm per month.
- Amounts are heavy-tailed, so take logs first, or use the median and MAD instead.
- Freeze the baseline during an alarm, and cap how much μ can rise per day, so an attacker cannot slowly push the baseline up.
- State (μ, σ, S) is stored on-chain and written once a minute; this is fine on testnet, but production needs a gas estimate.
- We found no paper applying CUSUM to exchange withdrawal monitoring, so there is no ready-made benchmark; we must validate it ourselves against the Bitget timeline.

### G. Quota bucket and worst-case loss bound

- The hot vault gets extra state: quota B (cap C) and the epoch of the last refill, e\_last.
- **Refill** accepts only Patrol's QUOTA(e, r\_e): e must equal e\_last + 1 (replay protection); refill only when reconciliation is clean; r\_e ≤ r\_max, lowered automatically on a CUSUM alarm.
- **Spend**: besides checking the verdict, execute also requires B ≥ a, then B ← B − a. A withdrawal without enough quota goes to the verification lane (two officers' signatures + timelock); it is not rejected.
- When the Confirmed level fires, B is set to zero immediately.

```latex
L(T) \le C + r_{max} \cdot \lceil T / \Delta \rceil, \qquad \Delta = 1\ \text{min}
```

- Example: with C = $500,000 and r\_max = $100,000 per minute, at most $3.2 million could leave through the fast lane during Bitget's 27 minutes; compare with about $228 million that left Bitget in the first 18 minutes (to be verified).
- Honest premise: the fast lane already requires the user's signature, so this bound protects against "signature verification itself being bypassed", for example a tampered KeyRegistry. It is the last layer of defence in depth.
- Parameters: C is a multiple of the per-minute outflow p99, and r\_max is the per-minute p99; measure the impact on normal users as "the share of minutes that need the verification lane".
- A similar approach is the ERC-7265 circuit breaker; the difference is that our quota can only be refilled by CRE when reconciliation is clean, and decoy evidence zeroes it directly.

### H. Alert ratchet and network propagation

- Local level L\_local ∈ {0, 1, 2, 3}; network level G = the highest level among Confirmed entries in the list that are still within their validity period; effective level L\_eff = max(L\_local, follow level).
- **Ratchet:** automatic raises can only come from CRE reports; there are only two ways down: expiry, or two officers' signatures + a timelock. Within the validity period, a level under automatic control only rises, never falls.
- A list entry carries the Merkle proof from C, a reference to the triggering transaction and a validity period (for example 72 hours); renewal needs new evidence.
- How other exchanges use it: exact address match → manual review; behaviour fingerprint match (fake-threshold amount band + new address + chain, discretised and hashed) → add λ to the account score.
- **Default follow level:** the supplementary material suggests G − 1. My judgement is that this is too aggressive: if any exchange in the network is attacked, the whole network rises to L2 for 72 hours, and normal users are slowed down across the board. By default, follow only up to L1, and let each exchange configure its own.

### I. One-hop taint tracing (P2)

- Start from the attacker address obtained from the decoy trigger and follow where it sends money. At trigger time the money usually has not moved yet, so Patrol keeps tracking for a period after the trigger.
- Proportional allocation (haircut): taint of next-hop address j = amount j received from the attacker / j's total inflow. With only one hop, personalised PageRank reduces to this ratio, so it is not needed.
- Determinism: fixed block range, edges sorted by transaction hash, integer arithmetic.
- Next-hop addresses are written only as "derived suspicious", with lower weight than the original address; exchange deposit addresses, DEX routers and cross-chain bridge contracts must be excluded, or large numbers of normal users will be hit by mistake.
- Known limit: once money enters a cross-chain bridge, traditional tracing breaks (this is exactly what ConneX discusses). Downstream is left to professional tracing firms; attribution is more accurate the earlier it happens, so our value is in "the first hop, at the first moment".

### J. Better to tighten wrongly than to loosen wrongly

Tightening acts on data from the LATEST block. Even if a later reorg causes a misjudgement, the cost is only one time-limited freeze. Loosening (unfreezing, refilling quota, lowering a level) must use FINALIZED data. This is the same principle as the ratchet in H.

## 7. Prevention layer: making the whole complete

Traps are not guaranteed to be touched, so a prevention layer is needed as a backstop. These are not the selling point, but they make it hard to succeed even for "an attacker who never touches a trap".

| Prevention layer | What it does | Why it is needed |
| --- | --- | --- |
| User intent check (seven gates) | Checks every withdrawal against the user's own signature and on-chain records | Even an attacker who never touches a trap cannot forge a user's signature |
| Transfer-only vault QuorumVault | Not upgradeable, no delegatecall | Blocks the Bybit and WazirX class of attack |
| Hidden and rotating parameters | The real threshold is derived per epoch from key K (HMAC), committed on-chain each epoch and revealed when it ends; every response is "processing + reference number" | Makes probing harder, and makes the decoy threshold work: the real threshold is not in the backend |
| Multi-chain reconciliation | Matches every outflow to a verdict within 60 seconds | Fills the gap on non-EVM chains |
| Config drift check, escape hatch | Freezes if contract config is changed; config changes go through a public timelock | Stops attackers from dismantling the defences first |
| Quota bucket | Every hot vault withdrawal spends quota; quota can only be refilled by Patrol each epoch, and only when reconciliation is clean; if it runs short, the withdrawal goes to the verification lane (Section 6 G) | Even if all detection fails, losses have a computable upper bound |

Traps and hidden parameters both depend on secrecy. Even if both are seen through, the foundation is still user signatures and on-chain facts. This answers Kerckhoffs's principle, which security-minded judges will think of.

## 8. System modules and why CRE

| Module | Where | What it does |
| --- | --- | --- |
| Trap workflow | CRE, log trigger | Listens for Transfer events from decoy wallets; after verification, writes a Confirmed-level tightening report with the decoy's Merkle reveal |
| Cosign workflow | CRE, log trigger | Seven-gate decision (including decoy accounts and the decoy threshold fingerprint); SPRT account score and silent tightening |
| Patrol workflow | CRE, cron 60 seconds | Native-coin and multi-chain decoy patrol; reconciliation; CUSUM; per-epoch quota refill; after a trigger, follows the attacker's next hop. Originally named Sentinel; renamed because a CRE hackathon project with the same name already exists |
| QuorumReceiver | On-chain | Accepts reports only from the specified workflow ID and owner; stores verdicts, alert level (ratchet), encrypted account scores, freeze deadlines |
| QuorumVault | On-chain | Transfer-only vault; quota bucket; funds can only be swept to the cold wallet |
| DecoyCommit | On-chain | Stores the Merkle root of the decoy list and each epoch's threshold commitment; verifies reveals |
| Decoy assets | On-chain + backend | Decoy wallets (multiple chains), decoy accounts (with real deposit history), decoy thresholds, decoy addresses, decoy credentials |
| KeyRegistry / DepositVault / ThreatRegistry | On-chain | Public keys, deposit records, shared suspicious list (verifies decoy proofs on write) |
| NOWNodes | External | Reads decoy wallets on non-EVM chains (for example XRP), mainnet historical replay, second data source |
| Quorum Console | Frontend | Pages such as Traps, Cases, Network, Timeline, Control status |

**Why CRE:**

1. **The trap list cannot live in the backend.** If the backend knows which item is a decoy, the attacker will avoid it; the list is stored as hashes in a CRE secret.
2. **Alerts cannot pass through the backend.** Detection reads on-chain facts directly, so deleting backend logs or switching off alerts does nothing.
3. **The response cannot depend on people.** Tightening is executed automatically on-chain by the report, without waiting for someone to get up in the middle of the night and shut machines down.
4. **The evidence is credible.** It is verified by multiple independent nodes, and every address written to the shared list carries on-chain evidence and a decoy commitment proof; only then will other exchanges dare to route to manual review on that basis. For stablecoin issuers, it can only shorten the preparation time for legal and manual processes: Circle's public position is that USDC is frozen only under a legal order (exact wording to be verified), and it will not freeze automatically because of the list.

## 9. How this differs from existing solutions

Honeypots themselves are not new. What is new is that after a trigger, a set of independent nodes directly tightens the money on-chain, and the backend cannot switch it off.

|  | Traditional honeypot / canary token | On-chain monitoring alerts | Custodian co-signing and rule engines | Quorum |
| --- | --- | --- | --- | --- |
| Who knows which item is a trap | The company's own systems | N/A | N/A | Only CRE; the backend does not know |
| After a trigger | Alert sent to people, through the company's own systems | Alert sent to people | N/A | Automatically tightens on-chain withdrawals |
| When the backend is compromised | Alerts may be switched off or deleted | Alerts remain, but nothing stops unless someone acts | A forged transaction that satisfies the rules is approved | Neither alarm nor tightening passes through the backend |
| When it acts | During reconnaissance | After money has started flowing out | At the moment of the strike | During reconnaissance and probing, before the large strike |

**Specific competitors and similar approaches (verify each one before citing)**

| Solution | What it does | How it differs from us |
| --- | --- | --- |
| [Safenet](https://docs.safefoundation.org/safenet/overview/introduction) (Safe Foundation, Beta on April 2, 2026) | Validators evaluate transactions independently, and Safe Guard verifies the proof on-chain before approving; the Beta only does static transaction checks | The closest competitor. It checks transaction structure; we check decoys and the user's own authorisation, and we have a cross-exchange list |
| Blockaid Cosigner, Hypernative Guardian | Off-chain check, then co-sign; nothing executes without the signature; removing Guardian requires a 24-hour timelock | Rule engines that look at the transaction itself; a forgery that satisfies the rules is approved |
| SEAL (Intel, Safe Harbor) | Sends threat intelligence to members; Safe Harbor pre-authorises white hats to step in during an attack | Intelligence goes to people; we turn intelligence into approval rules automatically. Complementary: a white-hat rescue can follow our tightening |
| ERC-7265 circuit breaker | Delays or reverts outflows that exceed a threshold | Threshold-triggered; ours is decoy-triggered, and quota can only be refilled by CRE |
| Chainlink Proof of Reserve / Secure Mint | Automatically halts minting at the contract level when collateral is insufficient | Official precedent: an oracle network acting as an automatic circuit breaker. We apply this idea to withdrawals |
| CRE hackathon projects: Sentinel, Guardian, Riskometer | Monitoring + DON-signed report + on-chain pause | Judges have most likely seen many "CRE monitoring + pause" projects. Our difference must rest on decoy triggers and the shared list, not on "CRE auto-pause" |

- **Wording:** in blockchain papers, "honeypot" mostly means a scam contract that tricks people into buying tokens. The technical sections always say "defensive decoy"; honeypot appears only in the opening metaphor.
- **A pitfall to remember:** the Sentinel project's own write-up says its "Pause with DON" looked successful but did not actually pause, because of an interface mismatch. A report landing on-chain does not mean the action took effect; we need a test that reads contract state specifically to confirm the vault really froze and the quota really went to zero.
- **Likely question:** a KeeperHub article argues that automated, independent polling of raw Safe Transaction Service data is enough to spot an anomalous operation field. Answer: that only defends against the Bybit class, where the signing interface is tampered with; it does not defend against a Bitget-style backend forging instructions directly, and it does not act during reconnaissance.
- **How to describe the novelty:** do not say "first ever". Say: we bring mature decoy detection (Honeywords) and randomised placement (ARMOR) to exchange withdrawals, with CRE as a decentralised checker; as far as our search found, no existing solution wires decoy triggers directly into automatic on-chain tightening and a cross-exchange shared list.

## 10. Limits and honest disclosures

- **Traps are not guaranteed to be touched.** A very careful attacker may avoid them, so the prevention layer is needed as a backstop. The video does not say "we will always catch them".
- **False triggers.** An employee or a normal program touching a decoy causes a freeze. Decoys must be isolated from normal processes; Confirmed-level freezes are time-limited, and extending one needs two officers' signatures.
- **Decoy wallets need a small amount of real money.** Losing it is a budgeted cost, paid in exchange for early detection.
- **Confirmed-level tightening is visible.** Stopping the bleeding comes first. The attacker will know he has been detected and may strike early; at that point, the already-swept hot wallets and the already-frozen warm wallets absorb it.
- **CRE secrets are plaintext to node operators.** If the list leaks, the traps stop working. Confidential Workflows is still in private beta; it is on the roadmap.
- **Native-coin decoys are not instant.** They rely on Patrol's patrol every 60 seconds.
- **Non-EVM chains.** Decoy wallets there can be detected, and the EVM side can be tightened, but nothing can be enforced on-chain on the non-EVM chain itself.
- **Decentralisation.** It only touches this exchange's own withdrawals; the shared list only marks "suspicious".
- **Effectiveness has only been measured in a test environment.** The video says so.
- **Out of scope.** Bugs in verification software (Liquid), bugs in key-generation programs (Coldcard), a user's own device being compromised.

**Limits of the hive network:** what a second exchange can recognise is the same address and the same technique; an attacker who switches to brand-new addresses is not recognised. The video does not say "at the next exchange, not a single drop gets out".

**Additional limits introduced by the algorithms:**

- **fail-slow, not fail-closed.** If CRE stops, quota is no longer refilled and the fast lane slowly drains; large amounts take the slow lane with two signatures + timelock. Nothing locks up, and nothing opens up. The industry also has fail-open designs (Flying Tulip's circuit breaker); the pitch should state this trade-off clearly.
- **Likelihood ratios for weak signals are assumed values.** There is no real data to calibrate them, only incident replays and red-team tests.
- **Decoy AUC can only be measured on synthetic data.** Account features from a real exchange are not available.
- **CUSUM will produce false alarms every day.** So it only takes soft actions.
- **The quota bucket bound only matters when signature verification is bypassed.**
- **Tracing covers only one hop.** It breaks once funds enter a cross-chain bridge.
- **Decoy wallets are ordinary wallets, while real hot wallets are contracts.** A very careful attacker can tell them apart by checking on-chain. We could make the decoys the same vault contract too, pointing to a fake Receiver that always approves, so he has to dig one layer deeper to tell them apart.
- **Key K is a single point of failure.** Salts, thresholds and score encryption are all derived from K, and K is plaintext to node operators.

## 11. Video demo script

Judges only watch the video: English subtitles throughout; every line is paired with evidence on screen; waiting time is cut to fast-forward and labelled as such. Plan for 3 minutes first.

| Time | Screen | Subtitle |
| --- | --- | --- |
| 0:00 | Hive metaphor animation: clean hexagons, no cartoon bees | Every exchange is a hive. Attackers always scout before they strike. |
| 0:15 | Bitget timeline: two test transfers at 18:31, large outflows at 18:58 | The attackers announced themselves 27 minutes early. Nobody was listening. |
| 0:30 | Reconciliation noticed only after 34 minutes; the attackers deleted records | Alarms inside a compromised system can be switched off. |
| 0:40 | One line, then cut to the real console | Here is what that looks like for real. |
| 0:50 | Red team at exchange A: reads the risk-control config (50 ETH, old hot wallet), sends a test transfer from the old hot wallet |  |
| 1:05 | Trap tripped → node consensus → funds swept, 2-hour freeze, address written to the list; block explorer | Tripped. Tightened. Marked. |
| 1:25 | Red team deletes the backend logs; the alarm and on-chain state are unchanged | Deleting the logs changes nothing. |
| 1:35 | Red team's large transfer out reverts; forged withdrawal rejected (three-column comparison, gate 3) | Even without the trap, he can't forge a user's signature. |
| 1:55 | **Switch to exchange B**: the same address goes to manual review, and the same probing pattern goes straight to L2; two consoles side by side | The second hive already knows his scent. |
| 2:15 | Timeline replay: marked at the very first test transfer | He thought he was caught at step three. He was marked at step one. |
| 2:30 | Bybit mainnet transaction replay (via NOWNodes), rejected |  |
| 2:40 | Hive network diagram + one line of limits + one closing line | Every attack makes every hive stronger. |

**Numbers to actually measure in the test environment:**

| Metric | How to measure | Algorithm |
| --- | --- | --- |
| Hit probability curve | P\_hit under different d/m and k | A |
| Decoy AUC | Classifier separating decoys from real accounts (synthetic data) | B |
| Detection latency | Seconds from a decoy being touched to the vault actually freezing and the quota actually reaching zero; read contract state, do not rely on transaction success | C, J |
| Amount the attacker can still take after the trigger | Red-team measurement | G |
| Worst-case loss | Replay along the Bitget timeline, with and without Quorum | G |
| False positive rate | Run CUSUM on synthetic normal outflows; false positives of the fake-threshold fingerprint on normal users | E, F |
| Network propagation time | Seconds from the list write to the second exchange routing to manual review | H |

All results come from real runs and are labelled as test-environment results.

## 12. 36-hour scope

| Priority | Content |
| --- | --- |
| P0 (core) | Decoy wallet (ERC-20) + Trap workflow; decoy accounts (with real deposit history); Confirmed-level tightening (zero quota, sweep funds, time-limited freeze, write to list); Receiver + QuorumVault + quota bucket (G); local ratchet (H); tighten on LATEST (J); red-team backend (with fake risk-control config); console Traps page |
| P0 (minimal prevention layer) | Cosign gates 1, 2, 3, 4; Cases review page |
| P1 (video climax) | Shared list + a second test exchange + network propagation (H); DecoyCommit and reveal (C); console Network page; timeline replay |
| P1 | SPRT account score and encrypted storage (E); HMAC threshold and commitment (D); decoy threshold fingerprint; Bybit replay; Patrol native-coin decoy patrol; hit probability curve (A, chart only) |
| P2 | CUSUM (F); one-hop tracing (I); decoy AUC (B); decoy credential callbacks; XRP decoy wallet (NOWNodes); multi-chain reconciliation; control level page; polish of the opening metaphor animation |

- [ ] Record a full version of the video at hour 26
- [ ] Feature freeze at hour 28; after that, only bug fixes and re-recording

## 13. Open questions and pre-competition checks

- [ ] Maximum video length; whether there is a live final for finalists
- [ ] Whether a CRE log trigger can filter by topic to listen only for Transfer events "sent from a decoy address"
- [ ] Actual seconds from event to report on-chain (measure once in simulation and once deployed)
- [ ] Three workflows exactly use up the per-org limit; whether one Cosign can serve both test exchanges at once without taking an extra slot
- [ ] When a CRE report reaches the Receiver, whether it can check the workflow ID and owner
- [ ] EIP-712 signature verification is feasible inside CRE; otherwise use on-chain ecrecover instead
- [ ] NOWNodes interfaces for reading mainnet historical transactions and XRP
- [ ] Whether we can get CRE Confidential Workflows access for the competition
- [ ] Check the amounts and dates of the five incidents one by one against the source texts
- [ ] Name: whether to keep Quorum (it clashes with JPMorgan / ConsenSys's Quorum) or switch to Propolis
- [ ] Team to confirm: duration of Confirmed-level freezes, automatic lowering of tightening levels, the list only marking suspicious

* [ ] Write a test: after a report arrives, read contract state to confirm the vault really froze and the quota really went to zero
* [ ] Whether a CRE workflow can do HMAC, keccak and symmetric encryption with identical results on every node
* [ ] Cost of writing CUSUM state on-chain every minute
* [ ] How to create real deposit history for decoy accounts, and how much money to put in
* [ ] Verify related work item by item: Hypernative, SEAL Safe Harbor terms, the ERC-7265 estimate for Euler (the developers' own estimate), each arXiv number, classic references cited from memory (Wald 1945, Page 1954, Axelsson 2000, Merkle 1987, RFC 2104, RFC 2697), the CUSUM ARL table
* [ ] Circle's exact wording on its USDC freezing position
* [ ] The figure of about $228 million leaving Bitget in the first 18 minutes

## 14. Sources

- [Bitget official incident timeline](https://www.bitget.com/academy/bitget-security-incident-what-happened-timeline-impact-response)
- [Bitget incident explained (Halborn)](https://www.halborn.com/blog/post/explained-the-bitget-hack-september-2026)
- [Attack details disclosed by Bitget (ChainCatcher)](https://www.chaincatcher.com/en/article/2292843)
- [Bitget laundering paths and freezes (BlockSec)](https://blocksec.com/blog/bitget-hack-laundering-fund-tracing)
- [Bybit and the signing interface (Max Avery)](https://www.maxavery.org/blog/bybit-the-largest-theft-in-the-asset-class-and-the-signing-interface-behind-it/)
- [Radiant Capital incident explained (Halborn)](https://www.halborn.com/blog/post/explained-the-radiant-capital-hack-october-2024)
- [WazirX incident explained (Halborn)](https://www.halborn.com/blog/post/explained-the-wazirx-hack-july-2024)
- [DMM Bitcoin and LinkedIn social engineering (CryptoSlate)](https://cryptoslate.com/fbi-reveals-north-korea-used-linkedin-to-steal-305-million-from-japans-dmm-bitcoin/)
- [THORChain pause vote reversed (Cointelegraph)](https://cointelegraph.com/news/thorchain-dev-exits-north-korea-transactions-halt-vote-fails)
- YT's Veil document (internal to the team)

**Algorithms and related work (compiled by teammates; verify before citing)**

- [Safenet documentation (Safe Foundation)](https://docs.safefoundation.org/safenet/overview/introduction); [Safenet Beta launch](https://safefoundation.org/blog/safe-launches-safenet-beta)
- [Honeywords (Juels & Rivest, ACM CCS 2013)](https://doi.org/10.1145/2508859.2516671)
- [Advancing Honeywords for Real-World Authentication Security](https://arxiv.org/abs/2510.22971)
- ARMOR (Pita et al., AAMAS 2008); Tambe, *Security and Game Theory* (Cambridge University Press)
- [Adaptive Honeypot Allocation via Bayesian Stackelberg Games](https://arxiv.org/abs/2505.16043); [Honeypot Allocation in Dynamic Tactical Networks](https://arxiv.org/abs/2308.11817)
- [Cryptocurrency Stealing Attack on Ethereum (RPC honeypots)](https://arxiv.org/abs/1904.01981)
- [ERC-7265 Circuit Breaker code](https://github.com/DeFi-Circuit-Breaker/v1-core); [Chainlink Proof of Reserve](https://chain.link/proof-of-reserve); [SEAL](https://securityalliance.org/our-work)
- [A survey of network analysis of cryptocurrency transactions (taint analysis)](https://arxiv.org/abs/2011.09318); [ConneX (cross-chain bridge transaction pairing)](https://arxiv.org/abs/2511.01393); Yousaf et al., *Tracing Transactions Across Cryptocurrency Ledgers*, USENIX Security 2019
- From memory, not verified: Wald 1945 (SPRT); Page 1954 (CUSUM); Axelsson 2000 (base-rate fallacy); Merkle 1987; RFC 2104 (HMAC); RFC 2697 (token bucket)
