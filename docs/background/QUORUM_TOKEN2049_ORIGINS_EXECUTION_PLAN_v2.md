# Quorum / Propolis — TOKEN2049 Origins 2026 Execution Plan

> **Purpose:** This file is the single handoff document for Codex and the team during the 36-hour TOKEN2049 Origins hackathon.
>
> **Primary objective:** Ship a working, judgeable security demo — not a research prototype with too many half-finished features.
>
> **Current date/context:** TOKEN2049 Origins Singapore, 6–8 Oct 2026, 36-hour hacking period.
>
> **Working project name:** `Quorum` (rename later only if needed).
>
> **Repository:** `https://github.com/Scarce01/TOKEN-2049-beta`
>
> **Important:** Existing repository work appears to predate kickoff. The official Origins rules state that project work must begin after the official hacking period starts; brainstorming is allowed beforehand, but not code/design/prototypes. Before relying on pre-existing implementation for judging, **confirm with organizer/mentor what existing code may be reused and what must be built during the event**. Do not hide this issue.

---

# 0. One-sentence mission

**Turn attacker reconnaissance into a liability.**

Quorum plants realistic defensive decoys inside an exchange-like environment. Instead of immediately blocking the first tiny probe, Quorum can allow a strictly bounded testnet canary, learn the attacker-controlled receiving infrastructure, trace linked on-chain addresses, have Chainlink CRE independently verify the evidence, then tighten withdrawals before the attacker attempts the real drain.

---

# 1. The problem we are solving

Modern crypto theft is not only a “private key stolen” problem or a “smart contract bug” problem.

A recurring failure pattern is:

1. attacker gains some degree of access, influence, or visibility;
2. attacker scouts the environment;
3. attacker tests what will be accepted;
4. the compromised or deceived system treats the malicious action as legitimate;
5. money moves;
6. detection happens after the irreversible transaction.

The core Quorum hypothesis is:

> **If reconnaissance is necessary, make reconnaissance observable and costly to the attacker.**

Traditional alerting often lives inside the same trust boundary that may already be compromised. Quorum’s important separation is:

- exchange/backend can be considered untrusted;
- decoys exist to generate high-confidence evidence;
- on-chain facts are independently checked;
- CRE is the independent decision layer;
- tightening is enforced outside the compromised backend;
- an attacker cannot simply delete a backend log to undo the security response.

---

# 2. Hackathon positioning

## Primary track

### Chainlink CRE — Best Workflow with CRE

CRE is the **security brain / independent authority**.

The key pitch is **not** “we use CRE to monitor transactions.”

The key pitch is:

> **The exchange backend may already be compromised. CRE sits outside that trust boundary, independently verifies the evidence, and can cause on-chain withdrawal controls to tighten even if the backend wants the opposite.**

## Secondary track

### NOWNodes — Multichain Infrastructure Challenge

NOWNodes is the **sensor / replay infrastructure**.

Use it for:

- public-chain transaction history;
- decoy wallet activity;
- attacker receiving-address funding history;
- historical incident replay;
- optional non-EVM expansion after the core demo works.

## After the first 12 hours, if stable

### Solana — Best Use of Solana

Potential extension:

- implement a minimal Solana protected vault/program;
- reuse Quorum threat evidence and CRE-triggered tightening;
- show the same “detect → verify → tighten” concept on Solana.

**Do not begin with Solana.**

The first 12-hour product should remain on the chain already best supported by the current repository, currently Base Sepolia / EVM.

## Optional / only after core demo

### Cardano — Agentic Commerce

Possible later adaptation:

- x402 agent payment guard;
- compare requested payment intent vs merchant / asset / amount;
- Quorum becomes a safety layer for AI agent spending.

This is a separate story. It must not derail the exchange-security demo.

## AWS

Use only if the on-site AWS challenge/requirements justify it.

AWS should be the **operations/control plane**, not the security authority:

- dashboard backend;
- event storage;
- case/timeline storage;
- simulation runner;
- logs.

A useful property to preserve:

> AWS/backend/dashboard can fail while the on-chain tightening state remains effective.

---


# CRE Track Qualification — P0 Gate

This section is a **hard qualification requirement**, not an optional enhancement.

Based on the on-site CRE Track qualification slide, the project must:

1. **Build, simulate, or deploy a CRE Workflow that is used as an orchestration layer within the project.**
2. The CRE Workflow must **integrate at least one blockchain** with at least one:
   - external API,
   - external system,
   - external data source,
   - LLM, or
   - AI agent.
3. The team must demonstrate either:
   - a **successful simulation through the CRE CLI**, or
   - a **live deployment on the CRE network**.

## Our safest qualification architecture

Use:

```text
Base Sepolia / EVM
        +
NOWNodes HTTP API
        +
Chainlink CRE Workflow
        +
QuorumReceiver / ThreatRegistry / QuorumVault
```

CRE must be the orchestrator:

```text
Decoy on-chain event
        │
        ▼
CRE Workflow
        │
        ├── Read blockchain event/state
        │
        ├── Call NOWNodes external API
        │      └── fetch receiver/funding history
        │
        ├── Deterministically evaluate evidence
        │
        ├── Generate DON/CRE report
        │
        └── Write security decision back on-chain
               │
               ├── ThreatRegistry
               └── QuorumVault tighten
```

## Important implementation rule

**Do not put the NOWNodes trace entirely in a normal backend and then send only the final boolean to CRE.**

That may make CRE look like a signer or final relay rather than the project's orchestration layer.

For the qualification demo, at least one workflow execution should visibly do all of the following:

```text
CHAIN INPUT
→ EXTERNAL API CALL
→ CRE COMPUTATION / DECISION
→ CHAIN OUTPUT
```

This gives the judges the clearest possible mapping to the stated track requirements.

## Minimum qualifying workflow

Recommended workflow name:

```text
trap-trace-tighten
```

Trigger:

```text
EVM log trigger:
DecoyTouched / Transfer involving committed decoy
```

Workflow actions:

```text
1. Read trigger transaction and relevant on-chain state.

2. Call NOWNodes:
   receiver transaction/funding history.

3. Extract deterministic evidence:
   - confirmed receiver;
   - direct upstream funder where supported;
   - evidence transaction hashes.

4. Verify decoy commitment / case context.

5. Produce security decision:
   confirmed receiver → TIGHTEN
   linked upstream    → LINKED / MANUAL

6. Generate CRE report.

7. Write report to QuorumReceiver / ThreatRegistry.

8. Read resulting contract state and verify:
   - threat entry exists;
   - quota/freeze/tightening state actually changed.
```

## CRE qualification demo command

The final submission must include a successful CRE CLI run.

Adapt to the repository's actual workflow name/settings, but the final evidence should look conceptually like:

```bash
cd workflows

cre workflow simulate trap-trace-tighten \
  -T staging-settings \
  --broadcast
```

If the existing repository keeps the logic under `trap`, `patrol`, or another workflow, **reuse it instead of creating a duplicate workflow solely for naming**.

The important thing is what the workflow actually orchestrates.

## Required judge-visible evidence

Record all of these:

```text
[1] CRE CLI command starts successfully.

[2] CRE trigger receives the on-chain decoy event.

[3] CRE logs show the NOWNodes/API request being executed.

[4] CRE obtains/aggregates the external result.

[5] CRE decision is generated.

[6] CRE report/write transaction is produced.

[7] Explorer/contract read shows actual on-chain state changed.

[8] Subsequent large withdrawal is blocked or diverted.
```

Do not rely only on:

```text
"CRE simulation succeeded"
```

The strongest proof is:

```text
successful CRE simulation
+
external API actually called
+
blockchain actually read
+
blockchain state actually changed
```

## Hour-12 CRE Definition of Done

Replace any weaker CRE milestone in this plan with the following:

- [ ] a real CRE workflow is used as the orchestration layer;
- [ ] workflow receives an on-chain trigger or reads on-chain state;
- [ ] workflow calls NOWNodes or another approved external source directly;
- [ ] workflow performs deterministic security logic;
- [ ] workflow produces the Quorum security decision;
- [ ] workflow writes/reports the decision back to blockchain;
- [ ] contract state is read back to confirm the action actually took effect;
- [ ] `cre workflow simulate ...` completes successfully through the CLI;
- [ ] terminal output is captured for the final submission;
- [ ] if deployment access is available, live CRE deployment is a bonus, not a blocker.

## Qualification-first fallback

If live DON deployment access is unavailable:

```text
CRE CLI simulation
+
live NOWNodes/API calls
+
public EVM/testnet calls
+
broadcast/on-chain state verification
```

is the primary fallback.

Do not spend hours waiting for deployment approval if simulation already satisfies the stated track qualification.

---


# 3. What must exist by Hour 12

By Hour 12, we need **one stable, repeatable live demo** and **one real-data backtest pipeline**.

## A. Live end-to-end demo

The exact story:

1. Attacker gets access to our **synthetic exchange account view**.
2. Attacker scanner sees only plausible account features — never the decoy label.
3. Scanner ranks high-value / active targets.
4. A realistic decoy naturally appears among the selected targets.
5. Attacker probes that account.
6. A tiny **testnet canary withdrawal** reaches an attacker-controlled receiving address.
7. Quorum marks state as `OBSERVE`, not yet full freeze.
8. Quorum traces 1–3 upstream linked addresses using public chain history.
9. CRE verifies the decoy proof + transaction evidence.
10. ThreatRegistry records:
   - confirmed receiver;
   - linked upstream infrastructure.
11. Withdrawal controls tighten.
12. Attacker attempts the real large drain.
13. The large drain is blocked / diverted to manual lane.
14. Console shows the whole timeline.

### Final live-demo sentence

> “The attacker thought the $10 probe told him our rules. It actually told us his infrastructure.”

## B. Historical attack replay

Use at least one real 2024–2025 incident, starting with:

### Bybit — 21 Feb 2025

Rules for the replay:

- do **not** preload later FBI/forensic labels into the detection algorithm;
- only use raw chain data available up to each simulated timestamp;
- run our tracing logic;
- after prediction, compare discovered addresses with public ground truth.

Metrics:

- precision;
- recall;
- top-K recall;
- first detection time;
- number of useful linked addresses;
- optional simulated loss exposure reduction.

Historical replay validates **tracing / detection**.

It does **not** validate whether a compromised exchange attacker would select a hidden internal decoy, because internal exchange account tables are not public chain data.

---

# 4. What the current repository already gives us

Based on the current repository snapshot:

```text
contracts/
  Receiver
  vaults
  RequestBoard
  KeyRegistry
  DepositVault
  ThreatRegistry
  ConfigTimelock
  Lens

workflows/
  trap
  cosign
  patrol

packages/shared/
packages/verify/

apps/exchange-api/
apps/console/
apps/user-app/

services/
  indexer
  trap-sync
  sim-runner
  decoy-admin
  redteam        <-- currently the natural place for our attacker simulator

datasets/
supabase/
```

Existing useful facts from the repo snapshot:

- contracts already have substantial unit/invariant testing;
- CRE decision logic already has deterministic tests;
- `apps/exchange-api` is a fake/untrusted exchange backend;
- `services/redteam` is the correct natural hook for the new attacker simulator;
- decoy indistinguishability is currently imperfect and must be treated honestly;
- CUSUM currently performs poorly on the Bitget-style drain and is not a priority;
- quota buckets reduce exposure but do not solve the attack alone;
- zero-value transfers are already ignored for trap activation.

Therefore:

> **Do not rebuild the existing backend. Do not start by understanding every contract. Use the smallest number of integration points necessary to make the demo work.**

---

# 5. Scope freeze

## P0 — Must work

- synthetic exchange account list;
- realistic decoy accounts mixed into the list;
- attacker ranking/scanner;
- deterministic attacker wallet graph on testnet;
- small canary withdrawal;
- decoy trigger;
- observe state;
- 1–3 hop chain tracing;
- CRE verification/report;
- ThreatRegistry update;
- vault tightening;
- large drain fails/manual lane;
- console timeline;
- Bybit historical replay;
- basic metrics output;
- fallback recorded demo.

## P1 — Do after P0

- second fake exchange / network propagation;
- second real historical incident;
- NOWNodes adapter clean-up;
- graph visualization;
- decoy AUC adversarial evaluation;
- simple loss-exposure timeline;
- Solana minimal protected-vault port.

## P2 — Only if everything is stable

- Cardano agent-commerce demo;
- address-poisoning detector;
- CUSUM improvements;
- one-hop taint weighting beyond simple funding graph;
- multi-chain dashboard;
- sophisticated ML;
- cross-chain bridge attribution;
- mixer heuristics;
- confidential workflow features;
- production-grade cluster attribution.

---

# 6. Explicit non-goals

During the hackathon we are **not** building:

- a real scanner of Bybit, Bitget, Binance, or any live exchange’s internal or externally exposed accounts;
- a tool for finding vulnerable real exchange accounts;
- credential testing;
- brute-force infrastructure;
- exploitation code against third parties;
- mixer deanonymization;
- guaranteed real-world hacker identity attribution;
- a production AML system;
- a full Chainalysis replacement;
- a full multi-chain tracing engine.

All attacker simulation must operate on:

- our own synthetic exchange dataset;
- our own testnet addresses;
- historical public blockchain data.

---

# 7. Core security model

## Trust assumptions

### Untrusted

- exchange backend;
- exchange API;
- operator UI;
- backend logs;
- attacker-visible configuration;
- account database labels.

### Trusted / independently verified

- blockchain facts;
- decoy commitment proof;
- approved CRE workflow identity;
- on-chain receiver/vault contracts;
- predefined protected cold destination;
- bounded testnet canary policy.

## Critical invariant

**The backend must never be able to tell the attacker which account/wallet is a decoy.**

Do not expose:

```text
isDecoy
isTrap
honeypot
securityLabel
trapId
decoyAddress
```

in any attacker-visible API response, frontend bundle, debug log, or ordinary backend endpoint.

---

# 8. Attacker simulator design

Directory:

```text
services/redteam/
├── README.md
├── config.ts
├── types.ts
├── wallets.ts
├── scanner.ts
├── ranker.ts
├── probe.ts
├── trace-client.ts
├── drain.ts
├── run-demo.ts
└── tests/
```

## 8.1 Attacker address roles

Use a simple enum:

```ts
export enum AttackerWalletRole {
  ROOT = "ROOT",
  FUNDER = "FUNDER",
  BURNER = "BURNER",
  RECEIVER = "RECEIVER",
  EXIT = "EXIT",
}
```

Meaning:

```text
ROOT
  ↓
FUNDER
  ↓
BURNER
  ↓
RECEIVER  ← receives decoy canary
  ↓
EXIT      ← optional, not required for Hour 12
```

For Hour 12, only three meaningful hops are needed:

```text
ROOT / FUNDER
      ↓
BURNER
      ↓
RECEIVER
```

Do not claim this is the attacker’s real-world identity.

Use language:

- `confirmed receiver`;
- `linked upstream address`;
- `attacker-controlled infrastructure candidate`;
- `cluster member`.

Avoid:

- “we identified the hacker”;
- “we found the person”;
- “this address definitely belongs to DPRK” unless public authoritative ground truth says so.

---

# 9. Synthetic exchange account model

The attacker needs a plausible target-selection problem.

Example attacker-visible schema:

```ts
export type AttackerVisibleAccount = {
  id: string;
  balanceUsd: number;
  accountAgeDays: number;
  deposits30d: number;
  withdrawals30d: number;
  lastActiveHours: number;
  kycTier?: number;
};
```

Security-only metadata must be stored separately:

```ts
export type SecurityOnlyAccountMetadata = {
  accountId: string;
  isDecoy: boolean;
  decoyCommitmentId?: string;
};
```

Never merge these and then “omit” fields at the API boundary if avoidable.

Prefer physically separate data paths.

---

# 10. Attacker ranking model

The ranking algorithm is not meant to model every real hacker.

It is an adversarial test of whether our decoys are attractive under plausible target-selection features.

Initial deterministic score:

```text
score =
  0.40 * normalized_balance
+ 0.25 * recent_activity
+ 0.20 * withdrawal_activity
+ 0.15 * account_age_credibility
```

The scanner returns:

```text
Top 20 target candidates
```

### Acceptance criterion

At least one decoy should naturally appear in the target set **without using decoy labels**.

### Important

Do not hardcode:

```ts
if (account.isDecoy) score += ...
```

That invalidates the experiment.

---

# 11. Decoy realism test

The current repo already identifies decoy distinguishability as a weakness.

Therefore add a red-team test:

> Given attacker-visible features only, how well can a classifier distinguish decoys from real-like accounts?

Target metric:

```text
AUC as close to 0.5 as practical.
```

For the hackathon:

- this is a diagnostic, not the main demo;
- do not block Hour-12 delivery on perfect AUC;
- report the actual number honestly.

If AUC is poor:

- reduce obviously synthetic feature patterns;
- sample decoy activity from real-like feature distributions;
- add plausible deposit/withdrawal history;
- avoid identical account-age bands;
- avoid deterministic balance patterns;
- ensure decoys have plausible transaction history.

---

# 12. Probe / canary policy

The new demo hypothesis is:

> The first decoy touch may be more valuable as intelligence than as an immediate visible freeze.

Therefore use a bounded state machine.

## State machine

```text
NORMAL
  ↓
DECOY_TOUCHED
  ↓
OBSERVE
  ↓
TRACE
  ↓
CONFIRM
  ↓
TIGHTEN
```

## Canary

For hackathon demo only:

```text
max canary = 10 test USDC
```

or equivalent testnet token.

Hard constraints:

- testnet only;
- capped amount;
- one canary per case;
- no production funds;
- no automatic repetition;
- timeout after first probe;
- if anything unexpected happens, fall back to immediate tightening.

The demo must make clear:

> This is a controlled honeypot experiment, not a recommendation to leak meaningful production funds.

---

# 13. Trace algorithm — Hour-12 version

Keep it intentionally simple.

Input:

```text
confirmed decoy transfer tx hash
receiver address
```

Algorithm:

1. identify receiver;
2. fetch receiver’s inbound funding transactions before the decoy event;
3. rank direct funders;
4. choose the most relevant funding edge under deterministic rules;
5. repeat for at most 2–3 hops;
6. stop at:
   - known service/contract;
   - bridge;
   - exchange deposit;
   - insufficient evidence;
   - maximum depth.

Output:

```ts
type TraceNode = {
  address: string;
  relation: "CONFIRMED_RECEIVER" | "FUNDED_BY" | "LINKED";
  confidence: "CONFIRMED" | "HIGH" | "LOW";
  evidenceTx?: string;
  blockNumber?: bigint;
};
```

## Determinism

For reproducibility:

- fixed block range;
- stable transaction ordering;
- no random tie-breaking;
- explicit stop rules;
- integer or exact-value comparisons where possible.

## No overclaiming

A funding edge proves a transaction relationship.

It does **not** prove the same human/entity controls both addresses.

Use “linked address” unless stronger public evidence exists.

---

# 14. NOWNodes integration

Create an adapter interface so the rest of the code does not depend directly on one provider.

```ts
export interface ChainDataProvider {
  getTransaction(txHash: string): Promise<ChainTx>;
  getAddressTransactions(
    address: string,
    opts: {
      beforeBlock?: bigint;
      afterBlock?: bigint;
      limit?: number;
    }
  ): Promise<ChainTx[]>;
  getTokenTransfers(
    address: string,
    opts?: { beforeBlock?: bigint; limit?: number }
  ): Promise<TokenTransfer[]>;
}
```

Implementation:

```text
NOWNodesProvider
```

Optional dev fallback:

```text
FixtureProvider
```

### Demo rule

The recorded/final demo should use real provider responses if stable.

Fixtures exist only as a fallback for presentation reliability and must be labeled as replay fixtures if used.

---

# 15. CRE integration

Do not add a completely separate architecture.

Reuse existing concepts:

```text
trap workflow
cosign workflow
patrol workflow
```

Hour-12 integration should be as small as possible.

## Required CRE decision

Input evidence:

```json
{
  "caseId": "...",
  "trigger": "DECOY_WITHDRAWAL",
  "decoyProof": "...",
  "receiver": "0x...",
  "evidenceTx": "0x...",
  "linkedAddresses": [
    {
      "address": "0x...",
      "relation": "FUNDED_BY",
      "evidenceTx": "0x..."
    }
  ]
}
```

Expected report semantics:

```text
receiver      = CONFIRMED
upstream      = LINKED
recommended   = TIGHTEN
```

Then on-chain:

```text
ThreatRegistry update
QuorumReceiver report
QuorumVault quota/freeze state update
```

## Important design distinction

The decoy touch is high-confidence evidence.

The traced upstream addresses are **linked**, not automatically equivalent to the confirmed receiver.

Therefore:

```text
confirmed receiver → strongest action
linked addresses    → manual / elevated scrutiny by default
```

Do not automatically freeze unrelated accounts solely because of a weak graph relation.

---

# 16. Large-drain stage

After the attacker sees the tiny canary succeed:

```text
attacker sends a large withdrawal request
```

Example:

```text
500,000 test USDC
```

Expected result:

```text
MATCH: confirmed receiver
or
MATCH: linked attacker infrastructure

→ withdrawal blocked or manual lane
```

The console must show:

```text
PROBE          SUCCESS
TRACE          COMPLETED
CRE            VERIFIED
REGISTRY       UPDATED
VAULT          TIGHTENED
LARGE DRAIN    FAILED
```

This is the demo climax.

---

# 17. Historical replay methodology

## First incident

### Bybit — 21 Feb 2025

We need two datasets:

### Raw chain data

Use public chain history via:

- NOWNodes;
- public RPC if necessary;
- pre-downloaded public transaction fixtures only as fallback.

### Ground truth

Use public authoritative / forensic sources after our prediction:

- FBI-published addresses when available;
- public forensic reports;
- public explorer labels;
- public Chainalysis research/blog material.

Do **not** use later labels as model inputs.

---

# 18. Time-travel rule for replay

This is critical.

For replay timestamp `T`:

```text
Quorum may only read blockchain facts with block time <= T.
```

No future information.

No labels published after the incident may be used for detection.

Ground truth is only revealed during evaluation.

Pseudo-flow:

```text
for each replay timestamp T:
    visible_chain = transactions where block_time <= T
    prediction = quorum.trace(seed, visible_chain)
    store(prediction)

after replay finishes:
    compare prediction with ground_truth
```

This prevents accidental look-ahead bias.

---

# 19. Historical evaluation metrics

Minimum:

## Precision

```text
TP / (TP + FP)
```

## Recall

```text
TP / (TP + FN)
```

## Top-K recall

Example:

```text
How many ground-truth addresses appear in our top 5 / 10 / 20?
```

## Detection latency

```text
first observable malicious/on-chain signal
→ first Quorum useful identification
```

## Graph depth

```text
useful linked addresses found within 1 hop / 2 hops / 3 hops
```

## Optional: simulated exposure avoided

This must be labeled as a simulation.

For a historical drain:

```text
actual cumulative outflow(t)
vs.
counterfactual outflow if Quorum tightened at T_detect + T_response
```

Do not claim “money saved” as fact.

Say:

> simulated exposure under our test policy.

---

# 20. Live demo screens

Keep the UI simple.

## Screen 1 — Attack

```text
ATTACKER SIMULATOR

Scanning 200 active accounts...
Ranked targets:
#1 acct_...
#2 acct_...
#3 acct_...

Target selected.
Sending 10 test USDC probe...
```

The attacker view should **not** reveal “DECOY”.

## Screen 2 — Security console

After probe:

```text
TRAP TRIPPED

Case: Q-2049-001
State: OBSERVE
Canary: ALLOWED
Receiver: 0x...
```

Then:

```text
TRACE

0xROOT
  ↓ funded
0xBURNER
  ↓ funded
0xRECEIVER
  ↑ decoy canary
```

Then:

```text
CRE VERIFIED

receiver: CONFIRMED
linked upstream: 2
action: TIGHTEN
```

Then:

```text
LARGE DRAIN ATTEMPT

500,000 test USDC
RESULT: BLOCKED / MANUAL LANE
```

## Screen 3 — Historical proof

```text
BYBIT 2025 REPLAY

No future labels used.

Precision: XX%
Recall: XX%
Top-10 recall: XX%
First useful detection: +XX min
```

Only show metrics that actually ran.

---

# 21. Hour 0–12 plan

## Hour 0–0.5 — Freeze the story

Owner: whole team.

Confirm:

- Base Sepolia/EVM first;
- attacker scanner sees synthetic internal accounts only;
- decoy label is hidden;
- first tiny canary may pass;
- trace is at most 3 hops;
- CRE verifies;
- large drain fails;
- historical replay is separate.

No architecture changes after this unless the existing repo makes something impossible.

### Deliverable

`docs/HACKATHON_SCOPE.md` or this file committed.

---

## Hour 0.5–1.5 — Repo boot + compliance check

Tasks:

```bash
pnpm install

cd contracts
forge test

cd ../workflows
bun install
bun test
```

Then run relevant services.

Confirm:

```text
contracts       PASS
workflows       PASS
exchange-api    UP
console         UP
indexer         UP or intentionally skipped
sim-runner      understood
```

Also ask organizer:

> “Our teammate has a pre-existing repo/prototype. What exactly can be reused under the rule that project work begins after kickoff?”

Record answer in:

```text
docs/HACKATHON_RULE_CONFIRMATION.md
```

### Kill rule

If the repo cannot boot within one hour, do not debug everything.

Isolate the minimal path required for the demo.

---

## Hour 1.5–3 — Build attacker scanner

Implement:

```text
services/redteam/types.ts
services/redteam/scanner.ts
services/redteam/ranker.ts
```

Create/obtain attacker-visible account endpoint.

### Acceptance

```text
scanner loads >=100 accounts
no decoy field is visible
ranker outputs top 20
```

Add test:

```text
response JSON does not contain forbidden keys:
isDecoy
trap
honeypot
securityLabel
```

---

## Hour 3–4 — Seed believable decoys

Create:

```text
real-like accounts
+
decoy accounts
```

Use the same attacker-visible feature distribution.

### Acceptance

- at least one decoy appears naturally in Top 20;
- selection is reproducible under fixed fixture;
- ranking code does not access security-only metadata.

Record:

```text
decoy hit / selected rank
```

Do not tune by directly reading labels inside the ranking code.

---

## Hour 4–5 — Create attacker wallet graph

On testnet:

```text
ROOT
→ FUNDER/BURNER
→ RECEIVER
```

Save public addresses and roles in a demo-only fixture:

```text
datasets/attacker-demo.public.json
```

Private keys:

- use normal testnet dev-key handling;
- never commit private keys;
- keep roles separated from UI labels where appropriate.

### Acceptance

Explorer/public RPC shows the funding edges.

---

## Hour 5–6 — Probe path

Implement:

```text
target selected
→ request small withdrawal
→ receiver gets tiny testnet canary
→ trap event exists
```

State:

```text
OBSERVE
```

### Acceptance

One command can reproduce:

```bash
pnpm redteam:probe
```

or equivalent.

---

## Hour 6–7.5 — NOWNodes trace

Implement:

```text
receiver
→ inbound funding edge
→ upstream address
→ second hop if clean
```

Maximum depth: 3.

### Acceptance

```text
trace output is deterministic
evidence includes tx hashes
no unsupported identity claims
```

Target command:

```bash
pnpm redteam:trace --case Q-2049-001
```

---

## Hour 7.5–9 — CRE → registry → tighten

Wire existing workflow rather than creating a new architecture.

### Acceptance

Given the case evidence:

```text
CRE simulation/broadcast succeeds
ThreatRegistry records confirmed receiver
linked addresses are recorded at weaker confidence
vault state changes
```

Read the actual contract state to verify tightening.

Do **not** treat “report tx succeeded” as sufficient.

---

## Hour 9–10 — Large drain

Implement:

```text
probe succeeds
large drain to confirmed receiver fails/manual
```

Optional second attempt:

```text
large drain to linked burner → manual review
```

### Acceptance

One script:

```bash
pnpm demo:live
```

runs the entire attacker sequence.

---

## Hour 10–11 — Historical replay v1

Implement a minimal replay CLI:

```bash
pnpm replay:bybit
```

Must:

- load seed transaction/address;
- query raw historical chain data;
- enforce cutoff timestamp/block;
- run 1–3 hop trace;
- export predictions.

Then compare with a separately loaded ground-truth file.

### Output

```json
{
  "precision": 0,
  "recall": 0,
  "top10Recall": 0,
  "firstDetectionSeconds": 0
}
```

Use actual values only after run.

---

## Hour 11–12 — Freeze + record

No features.

Do only:

- fix demo-breaking bugs;
- verify reproducibility;
- record full fallback video;
- export screenshots;
- save exact commands;
- commit known-good SHA;
- tag:

```text
hour12-stable
```

---

# 22. Hour 12–24 plan

Only proceed after Hour-12 stable demo exists.

## Priority order

1. improve console narrative;
2. make NOWNodes usage visible and auditable;
3. add second historical replay;
4. add network propagation / second exchange;
5. improve decoy realism test;
6. add basic loss-exposure chart;
7. only then consider Solana.

## Second historical incident candidates

Preferred:

- DMM Bitcoin 2024;
- WazirX 2024;
- Radiant 2024.

Pick the incident with the cleanest public on-chain ground truth.

Do not pick based only on headline size.

---

# 23. Hour 24–30 plan

## Demo hardening

- reset script;
- seeded deterministic data;
- health check;
- clear case database;
- retry-safe workflow;
- stable RPC/provider fallback;
- cache historical replay data;
- one-click run;
- one-click reset.

## Pitch evidence

Capture:

```text
1. scanner selected decoy without label
2. canary tx
3. trace tx graph
4. CRE verified
5. registry state
6. vault state
7. failed large drain
8. real historical replay metrics
```

---

# 24. Hour 30–36 plan

No major features.

## Freeze functionality around Hour 30–32

After freeze:

- video;
- pitch;
- captions;
- README;
- architecture diagram;
- backup demo;
- judge Q&A;
- sponsor-specific evidence.

## Final fallback hierarchy

### Level 1
Full live demo.

### Level 2
Live console + cached historical data.

### Level 3
Recorded full demo with block explorer evidence.

Never depend on venue Wi-Fi for the only valid proof.

---

# 25. Suggested package scripts

Codex should adapt these to the existing monorepo rather than blindly adding duplicates.

Target UX:

```json
{
  "scripts": {
    "demo:seed": "...",
    "demo:reset": "...",
    "redteam:scan": "...",
    "redteam:probe": "...",
    "redteam:trace": "...",
    "redteam:drain": "...",
    "demo:live": "...",
    "replay:bybit": "...",
    "demo:health": "..."
  }
}
```

Desired judge-day flow:

```bash
pnpm demo:reset
pnpm demo:seed
pnpm demo:health
pnpm demo:live
pnpm replay:bybit
```

---

# 26. Demo orchestration pseudocode

Safe test-only orchestration:

```ts
async function runDemo() {
  assertDemoEnvironment(); // testnet/local only

  const accounts = await loadAttackerVisibleAccounts();

  const ranked = rankTargets(accounts);

  renderAttackerRanking(ranked);

  const target = ranked[0];

  const receiver = getDemoWallet(AttackerWalletRole.RECEIVER);

  const probe = await requestBoundedTestnetProbe({
    accountId: target.id,
    receiver: receiver.address,
    amount: "10",
  });

  const caseId = await waitForDecoyCase(probe.txHash);

  await setCaseState(caseId, "OBSERVE");

  const trace = await traceFundingGraph({
    receiver: receiver.address,
    maxDepth: 3,
    cutoffBlock: probe.blockNumber,
  });

  const report = await runCreVerification({
    caseId,
    probe,
    trace,
  });

  await assertTighteningState(report);

  const drain = await attemptTestnetDrain({
    amount: "500000",
    receiver: receiver.address,
  });

  assert(drain.status === "BLOCKED" || drain.status === "MANUAL");

  renderFinalTimeline({
    accounts,
    ranked,
    probe,
    trace,
    report,
    drain,
  });
}
```

`assertDemoEnvironment()` must refuse to run against arbitrary live targets.

Example checks:

```text
expected chain ID
expected contract addresses
explicit DEMO_MODE=true
known exchange-api base URL
known fixture dataset id
```

---

# 27. Historical replay pseudocode

```ts
async function replayHistoricalCase(caseSpec: HistoricalCase) {
  const provider = createHistoricalChainProvider();

  const visibleData = provider.withCutoff(caseSpec.cutoff);

  const prediction = await runTrace({
    seed: caseSpec.seed,
    provider: visibleData,
    maxDepth: caseSpec.maxDepth,
  });

  // Ground truth is loaded AFTER prediction.
  const truth = await loadGroundTruth(caseSpec.groundTruthFile);

  return evaluate(prediction, truth);
}
```

### Test

Fail the test if any detection component imports or reads:

```text
groundTruthFile
futureLabels
futureBlocks
```

before prediction is finalized.

---

# 28. Data layout

Suggested:

```text
datasets/
├── synthetic/
│   ├── accounts.json
│   ├── security-labels.private.json
│   └── attacker-ranking-fixture.json
├── demo/
│   ├── attacker-wallets.public.json
│   └── expected-flow.json
└── historical/
    └── bybit-2025/
        ├── case.json
        ├── seed.json
        ├── raw-cache/
        ├── ground-truth.public.json
        ├── sources.md
        └── results.json
```

Never put private test keys into committed JSON.

---

# 29. `HistoricalCase` schema

```ts
export type HistoricalCase = {
  id: string;
  title: string;
  chainId: number;
  incidentDate: string;

  seed: {
    txHashes?: string[];
    addresses?: string[];
  };

  replayStartBlock: bigint;
  replayEndBlock: bigint;

  maxDepth: number;

  groundTruthFile: string;

  notes: string[];
};
```

---

# 30. Threat classification for the demo

Use different confidence levels.

## Confirmed

Directly receives a transaction from a revealed decoy.

```text
CONFIRMED_RECEIVER
```

## Strongly linked

Direct funding relationship immediately preceding the probe, under explicit deterministic rules.

```text
LINKED_UPSTREAM
```

## Weakly linked

Additional graph relationship without enough evidence.

```text
DERIVED_SUSPECT
```

Policy:

```text
CONFIRMED_RECEIVER → strongest automated tightening
LINKED_UPSTREAM     → manual / elevated scrutiny
DERIVED_SUSPECT    → information only by default
```

This prevents graph contamination from causing uncontrolled freezes.

---

# 31. Attack enum / case enum

Suggested types:

```ts
export enum AttackStage {
  SCANNING = "SCANNING",
  TARGET_SELECTED = "TARGET_SELECTED",
  PROBING = "PROBING",
  DECOY_TOUCHED = "DECOY_TOUCHED",
  OBSERVING = "OBSERVING",
  TRACING = "TRACING",
  VERIFIED = "VERIFIED",
  TIGHTENED = "TIGHTENED",
  DRAIN_ATTEMPTED = "DRAIN_ATTEMPTED",
  DRAIN_BLOCKED = "DRAIN_BLOCKED",
}

export enum ThreatRelation {
  CONFIRMED_RECEIVER = "CONFIRMED_RECEIVER",
  LINKED_UPSTREAM = "LINKED_UPSTREAM",
  DERIVED_SUSPECT = "DERIVED_SUSPECT",
}

export enum CaseAction {
  OBSERVE = "OBSERVE",
  MANUAL_REVIEW = "MANUAL_REVIEW",
  TIGHTEN = "TIGHTEN",
  RELEASE = "RELEASE",
}
```

---

# 32. Console timeline data model

```ts
export type CaseTimelineEvent = {
  id: string;
  caseId: string;
  timestamp: string;
  stage: AttackStage;
  title: string;
  txHash?: string;
  address?: string;
  metadata?: Record<string, unknown>;
};
```

Example:

```text
10:02:11  TARGET_SELECTED
10:02:18  PROBE_SENT
10:02:25  DECOY_TOUCHED
10:02:26  OBSERVE
10:02:31  RECEIVER_CONFIRMED
10:02:35  UPSTREAM_LINK_FOUND
10:02:43  CRE_VERIFIED
10:02:49  VAULT_TIGHTENED
10:03:10  LARGE_DRAIN_ATTEMPTED
10:03:11  DRAIN_BLOCKED
```

The timestamps shown in the actual demo must be real measured values.

---

# 33. Testing requirements

## Unit

- ranker cannot access private decoy metadata;
- forbidden keys absent from attacker API;
- trace depth respected;
- trace cutoff respected;
- deterministic graph output;
- linked vs confirmed classification correct;
- canary cap enforced;
- large drain obeys tightened state.

## Integration

- decoy probe emits expected event;
- CRE report reaches receiver;
- registry state changes;
- vault state actually changes;
- backend log deletion does not restore withdrawal ability.

## Historical

- no future data leakage;
- metric calculation reproducible;
- ground truth loaded only after prediction.

## Demo regression

A single automated test should run:

```text
seed
→ scan
→ probe
→ observe
→ trace
→ verify
→ tighten
→ drain
```

---

# 34. “Backend compromised” demo

To prove the trust-boundary story:

After the trap is triggered:

1. delete fake backend event/log;
2. optionally make fake backend display “all clear”;
3. read on-chain Quorum state;
4. attempt large drain;
5. demonstrate it still fails.

Judge takeaway:

> **Deleting the exchange’s own evidence changes nothing.**

This is more valuable than adding another dashboard chart.

---

# 35. Historical replay vs synthetic demo — do not confuse them

## Synthetic exchange

Proves:

- decoy attractiveness;
- decoy indistinguishability;
- target selection;
- full end-to-end control path.

## Historical attack

Proves:

- tracing logic;
- latency;
- graph precision/recall;
- potential intervention timing.

## Testnet live chain

Proves:

- implementation really executes;
- CRE really reports;
- contracts really change state;
- drain really fails.

Final pitch should explicitly present these as **three different validation layers**.

---

# 36. Metrics board

Only show metrics that have actual source tags.

Every metric should be tagged:

```text
[TESTNET]
[HISTORICAL ON-CHAIN]
[SYNTHETIC]
[ASSUMED]
```

Examples:

```text
Decoy selected in Top 20     [SYNTHETIC]
Trace precision              [HISTORICAL ON-CHAIN]
CRE → tightened state time   [TESTNET]
Large drain failed           [TESTNET]
Counterfactual loss bound    [ASSUMED / SIMULATED]
```

Never mix these categories.

---

# 37. Known weaknesses to preserve honestly

Do not hide:

- not every attacker will touch a decoy;
- decoys can potentially be fingerprinted;
- upstream funding links do not prove shared identity;
- bridges/mixers can break simple tracing;
- historical ground truth is incomplete;
- CUSUM is not currently reliable enough to be central;
- quota bucket slows but does not eliminate large drain exposure;
- testnet timing is not mainnet timing;
- CRE/secret assumptions remain part of the system;
- canary strategy must be tightly bounded.

Honesty makes the pitch stronger because the architecture has fallback layers.

---

# 38. Kill criteria

If a feature fails its deadline, cut it.

## Cut immediately if:

### By Hour 6
Scanner + probe does not work.

Cut UI polish.

### By Hour 8
NOWNodes trace is unreliable.

Use cached public-chain replay data and clearly label it.

### By Hour 9
CRE live workflow is unstable.

Use existing `sim-runner` / CRE simulation path, while still proving on-chain state change if allowed.

### By Hour 10
Historical pipeline is not complete.

Do only Bybit; do not add a second incident.

### By Hour 12
Core demo works.

Freeze it before any Solana/Cardano work.

---

# 39. Suggested team split

Adapt to actual team size.

## Person A — Security / backend

- exchange-api interface;
- decoy seeding;
- trap event;
- vault integration.

## Person B — Red team / data

- scanner;
- attacker wallet graph;
- NOWNodes trace;
- historical replay.

## Person C — CRE / contracts

- workflow;
- receiver;
- registry;
- vault state verification.

## Person D — frontend / pitch

- console;
- timeline;
- graph;
- recording;
- sponsor narrative.

If only 2 people:

### Engineer 1
existing backend + contracts + CRE.

### Engineer 2
redteam + historical replay + console glue.

Do not have both engineers constantly editing the same core module.

---

# 40. Codex working rules

Codex should follow these rules.

## Rule 1 — Read before editing

First inspect:

```text
README / pasted repo snapshot
docs/proposal_v4.md
CLAUDE.md
docs/STATUS.md
docs/KEYS.md
docs/TEAM_WORKFLOW.md
services/redteam/
apps/exchange-api/
workflows/
contracts/
packages/shared/
```

Do not rewrite architecture until the current interfaces are known.

## Rule 2 — Prefer integration over replacement

If an existing contract/workflow already solves 80% of the need, adapt the simulator to it.

## Rule 3 — Small commits

Commit after each stable milestone:

```text
redteam scanner
decoy selection
attacker wallet graph
probe
trace
CRE integration
drain demo
historical replay
```

## Rule 4 — Do not fabricate success

Never insert fake metrics into README/demo output.

## Rule 5 — Preserve source labels

Every result must state whether it is:

```text
test
testnet
historical on-chain
synthetic
assumed
```

## Rule 6 — Security boundary

Do not turn the red-team simulator into a live exchange targeting tool.

## Rule 7 — Demo reset must be deterministic

A judge should be able to re-run the flow.

---

# 41. First Codex task

Codex should begin with a repository inspection only.

Prompt:

```text
Read this PLAN.md and inspect the repository.

Do not implement anything yet.

Return:
1. the exact existing files/modules that already cover each P0 requirement;
2. the minimum new files required;
3. the APIs/events/contracts we should reuse;
4. any contradiction between PLAN.md and the current code;
5. the smallest implementation path to reach the Hour-12 acceptance criteria;
6. current test commands and which tests are already passing;
7. any blockers that would force us to change the demo;
8. a CRE track qualification audit proving whether an existing workflow already:
   a. acts as the orchestration layer,
   b. integrates blockchain data/state,
   c. directly calls an external API/system/data source (prefer NOWNodes),
   d. can be successfully demonstrated with `cre workflow simulate`,
   e. writes/verifies the final security state on-chain.

Do not redesign the project.
Do not add features.
Do not touch Solana/Cardano yet.
Do not build anything that scans real exchanges or third-party targets.
```

After that inspection, the next Codex task should be:

```text
Implement only the first milestone:
attacker-visible account schema + scanner + deterministic ranker + tests proving decoy labels are unavailable to attacker code.

Stop after tests pass and report changed files.
```

---

# 42. Hour-12 Definition of Done

All of these must be true:

- [ ] repo boots in the chosen demo mode;
- [ ] attacker-visible account endpoint contains no decoy metadata;
- [ ] scanner ranks at least 100 synthetic accounts;
- [ ] decoy naturally appears in selected candidates under fixed test fixture;
- [ ] testnet attacker wallet graph exists;
- [ ] tiny canary probe succeeds;
- [ ] decoy event is detected;
- [ ] case moves to OBSERVE;
- [ ] NOWNodes/public-chain trace finds at least one correct upstream funding link in our test graph;
- [ ] CRE verifies evidence;
- [ ] receiver is recorded as confirmed;
- [ ] linked upstream address is not overclassified;
- [ ] vault is actually tightened on-chain;
- [ ] large drain attempt fails or goes manual;
- [ ] deleting backend logs does not reverse the protection;
- [ ] Bybit historical replay runs with no future-data leakage;
- [ ] real replay metrics are exported;
- [ ] one complete fallback video is recorded;
- [ ] exact demo commands are documented;
- [ ] known-good commit/tag exists.

---

# 43. Final 3-minute pitch structure

## 0:00–0:20 — Problem

“Attackers often test before they drain. Today that reconnaissance teaches the attacker about the exchange.”

## 0:20–0:35 — Reversal

“Quorum makes reconnaissance reveal the attacker instead.”

## 0:35–1:25 — Live attack

- scanner;
- decoy selected;
- $10 probe;
- receiver exposed;
- trace begins.

## 1:25–1:55 — Independent response

- CRE verifies;
- ThreatRegistry updates;
- vault tightens;
- backend log deleted;
- protection remains.

## 1:55–2:15 — Attack climax

- $500k drain attempted;
- fails.

## 2:15–2:40 — Real-world validation

- Bybit historical replay;
- actual metrics;
- no future labels used.

## 2:40–3:00 — Network effect / sponsor story

“NOWNodes gives us the chain history. CRE makes the independent security decision. The protected vault enforces it. Every confirmed attack can make the next protected system harder to exploit.”

---

# 44. Success criteria for judging

The project is successful if a judge can answer “yes” to these questions:

1. Did the attacker select the decoy without being told it was a decoy?
2. Did a real on-chain/testnet transaction provide evidence?
3. Did the system learn a real attacker-controlled demo receiving address?
4. Did tracing produce verifiable transaction relationships?
5. Did CRE independently verify the security event?
6. Did on-chain security state actually change?
7. Did the later large drain fail?
8. Would deleting the backend log fail to undo the protection?
9. Was at least one historical attack replayed without look-ahead information?
10. Are all accuracy claims labeled with real provenance?

If yes, stop adding features.

---

# 45. Immediate next action

**Do not code from this plan blindly.**

First run the Codex repository-inspection prompt in Section 41.

The first implementation target is only:

```text
attacker-visible account schema
+
scanner
+
ranker
+
decoy-label isolation tests
```

Once that passes, proceed to:

```text
attacker wallet graph
→ bounded canary
→ trace
→ CRE
→ tighten
→ drain
```

The project wins by proving one complete security story, not by finishing every idea in the proposal.
