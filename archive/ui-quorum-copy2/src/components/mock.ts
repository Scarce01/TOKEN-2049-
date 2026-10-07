/** Product mock data — demo environment. Everything links back to case #QRM-78452. */

export const CASE_ID = 'QRM-78452'

export type Req = { id: string; t: string; source: string; user: string; asset: string; amount: string; usd: string; from: string; to: string; cosign: boolean; state: 'Approved' | 'Pending' | 'Rejected' | 'Escalated' | 'Held'; constraint: string; note: string; gate?: number; reason?: string; invalid?: { reason: string; sig: string; trap: string } }
export const REQUESTS: Req[] = [
  { id: 'RB-310944', t: '14:02:03', source: 'Exchange A', user: 'acct QA-114 (decoy)', asset: 'ETH', amount: '0.42', usd: '$1,092', from: 'Hot Vault', to: '0x7a3f…91c2', cosign: true, state: 'Rejected', constraint: 'ThreatRegistry match · destination flagged', gate: 3, reason: 'THREAT_MATCH', note: 'Request referenced a decoy account. Linked to case #QRM-78452.' },
  { id: 'RB-310943', t: '14:01:58', source: 'Exchange A', user: 'acct 88f1…02', asset: 'USDC', amount: '184,000', usd: '$184,000', from: 'Hot Vault', to: '0x91c2…a0d4', cosign: true, state: 'Escalated', constraint: 'Exceeds post-trigger quota (0)', gate: 6, reason: 'QUOTA_ZERO', note: 'Arrived during tightening window; held for operator review.' },
  { id: 'RB-310941', t: '14:01:40', source: 'Exchange A', user: 'acct 41aa…7c', asset: 'ETH', amount: '12.0', usd: '$31,200', from: 'Hot Vault', to: '0xbe20…44e1', cosign: true, state: 'Pending', constraint: 'Hidden threshold band 2', gate: 7, reason: 'KEY_DELAY', note: 'Cosign awaiting second Patrol reconciliation tick.' },
  { id: 'RB-310938', t: '14:00:12', source: 'Exchange A', user: 'acct 0c7d…91', asset: 'USDT', amount: '2,500', usd: '$2,500', from: 'Hot Vault', to: '0x7710…c3a8', cosign: false, state: 'Approved', constraint: 'Within quota bucket', note: 'Below review band; QuorumVault quota allowed execution.' },
  { id: 'RB-310930', t: '13:58:11', source: 'Exchange B', user: 'acct b-3381', asset: 'WBTC', amount: '1.8', usd: '$118,440', from: 'Warm Vault', to: '0x4e9d…0b17', cosign: true, state: 'Approved', constraint: 'Intent signature verified', note: 'User intent verified; queued for QuorumVault execution.' },
  { id: 'RB-310927', t: '13:55:47', source: 'Agent wallet · Sable', user: 'agent sable-04', asset: 'ETH', amount: '3.2', usd: '$8,320', from: 'Hot Vault', to: '0x22ac…e9f0', cosign: true, state: 'Approved', constraint: 'Agent policy scope ok', note: 'Within agent spend policy and daily quota.' },
  { id: 'RB-310919', t: '13:51:02', source: 'Exchange A', user: 'acct 9a10…3e', asset: 'ETH', amount: '64.0', usd: '$166,400', from: 'Warm Vault', to: '0x7a3f…91c2', cosign: true, state: 'Rejected', constraint: 'Destination later flagged (retro-match)', gate: 3, reason: 'RETRO_MATCH', note: 'Patrol retro-linked this request to the same attacker cluster.' },
  { id: 'RB-310902', t: '13:44:30', source: 'DAO Treasury · Meridian', user: 'multisig 3/5', asset: 'USDC', amount: '750,000', usd: '$750,000', from: 'Cold Vault', to: '0x0fd1…8a62', cosign: true, state: 'Held', constraint: 'Cold timelock 72h', gate: 6, reason: 'TIMELOCK_HOLD', note: 'Timelock extended by Trap Workflow at 14:02:31.' },
  { id: 'RB-310947', t: '14:02:05', source: 'Exchange A', user: 'acct QA-114 (decoy)', asset: 'ETH', amount: '240.0', usd: '$624,000', from: 'Hot Vault', to: '0x7a3f…91c2', cosign: true, state: 'Rejected', constraint: 'Forged request · intent signature invalid', gate: 1, reason: 'SIG_INVALID', note: 'Submitted by compromised backend with no valid user intent. Linked to case #QRM-78452.', invalid: { reason: 'Rejected at gate 1 · no matching user intent', sig: 'ECDSA recover → 0x0000…dead ≠ registered key 0x41aa…7c', trap: 'Touched DW-07' } },
  { id: 'RB-310948', t: '14:02:09', source: 'Exchange A', user: 'acct 88f1…02', asset: 'USDC', amount: '1,200,000', usd: '$1,200,000', from: 'Warm Vault', to: '0x91c2…a0d4', cosign: true, state: 'Rejected', constraint: 'Forged request · replayed signature', gate: 1, reason: 'SIG_REPLAY', note: 'Signature nonce already consumed by RB-310943. Linked to case #QRM-78452.', invalid: { reason: 'Rejected at gate 1 · replayed intent', sig: 'Nonce 0x1f4 already used · signature bound to RB-310943', trap: 'Enumerated DA-114' } },
  { id: 'RB-310949', t: '14:02:12', source: 'Exchange A', user: 'acct 0c7d…91', asset: 'ETH', amount: '880.0', usd: '$2.29M', from: 'Hot Vault', to: '0x5c11…d07a', cosign: true, state: 'Rejected', constraint: 'Forged request · RequestBoard mismatch', gate: 2, reason: 'BOARD_MISMATCH', note: 'Amount differs from RequestBoard entry. Linked to case #QRM-78452.', invalid: { reason: 'Rejected at gate 2 · payload hash ≠ RequestBoard entry', sig: 'Signature valid for 8.8 ETH, request claims 880.0 ETH', trap: 'Touched DW-07' } },
]

export const ACCOUNTS: Record<string, { id: string; status: string; notBefore: string; notBeforeTs: number; lastChange: string; deposit: string; proof: string; delay: boolean }> = {
  '41aa7c': { id: 'acct 41aa…7c', status: 'KEY DELAY · new key not yet active', notBefore: 'Oct 05 14:44:58 UTC', notBeforeTs: Date.now() + (42 * 60 + 18) * 1000, lastChange: 'Oct 05 13:44:58 · key rotated via KeyRegistry', deposit: '12.4 ETH · Oct 02 · blk 21,881,402', proof: 'Merkle proof 0x9b2e…41d0 ✓ (Patrol verified)', delay: true },
  '88f102': { id: 'acct 88f1…02', status: 'Active', notBefore: 'Sep 14 08:12:00 UTC', notBeforeTs: 0, lastChange: 'Sep 13 08:12 · registered', deposit: '220,000 USDC · Sep 20', proof: 'Merkle proof 0x31aa…0e7f ✓', delay: false },
}
export const acctKey = (s: string) => s.replace(/^acct\s*/, '').replace(/[^0-9a-zA-Z]/g, '')

export const APPROVALS = [
  { id: 'AP-0412', action: 'Manual release', detail: '420 ETH · Warm Vault → Exchange A ops', vault: 'Warm Vault', signed: ['M. Kovač'], required: 2, state: 'Pending', queued: 'Oct 05 14:21', expiry: 'Oct 05 20:21 · 6h' },
  { id: 'AP-0411', action: 'Freeze extension', detail: 'Cold timelock 72h → 96h', vault: 'Cold Vault', signed: ['M. Kovač', 'J. Ruiz'], required: 2, state: 'Verified', queued: 'Oct 05 14:09', expiry: 'executed 14:11' },
  { id: 'AP-0410', action: 'Relaxation', detail: 'hot.quota 0 → 800 ETH (CT-0194)', vault: 'Hot Vault', signed: [] as string[], required: 2, state: 'Queued', queued: 'Oct 05 14:15', expiry: 'timelock ends Oct 07 14:15' },
]

export type Decoy = { id: string; type: 'Wallet' | 'Address' | 'Account' | 'API key' | 'Threshold' | 'Credential'; label: string; ref: string; host: string; state: 'Armed' | 'Triggered' | 'Rotating' | 'Retired'; deployed: string; hits: number; lastHit: string; commit: string; lure: number }
export const DECOYS: Decoy[] = [
  { id: 'DW-07', type: 'Wallet', label: 'Hot overflow wallet', ref: '0x5c11…d07a', host: 'Exchange A', state: 'Triggered', deployed: 'Sep 12', hits: 1, lastHit: '14:02:07 today', commit: '0xc71d…0a92', lure: 0.92 },
  { id: 'DA-114', type: 'Account', label: 'VIP account QA-114', ref: 'acct QA-114', host: 'Exchange A', state: 'Triggered', deployed: 'Sep 12', hits: 3, lastHit: '14:01:52 today', commit: '0x8a02…11fe', lure: 0.85 },
  { id: 'DX-21', type: 'Address', label: 'Withdrawal whitelist entry', ref: '0x9e3b…4c20', host: 'Exchange A', state: 'Armed', deployed: 'Sep 30', hits: 0, lastHit: '—', commit: '0x14bb…e3a1', lure: 0.7 },
  { id: 'DK-03', type: 'API key', label: 'Legacy treasury API key', ref: 'qk_live_…f81', host: 'Exchange A', state: 'Armed', deployed: 'Aug 28', hits: 0, lastHit: '—', commit: '0x5f60…72cd', lure: 0.78 },
  { id: 'DT-02', type: 'Threshold', label: 'Published review limit 50 ETH', ref: 'cfg.review_eth', host: 'Exchange A', state: 'Rotating', deployed: 'Oct 01', hits: 0, lastHit: '—', commit: '0x02de…9b44', lure: 0.6 },
  { id: 'DC-09', type: 'Credential', label: 'Ops signer seed (canary)', ref: 'vault/ops/seed.bak', host: 'Exchange B', state: 'Armed', deployed: 'Sep 19', hits: 0, lastHit: '—', commit: '0x7ab9…c015', lure: 0.88 },
  { id: 'DW-11', type: 'Wallet', label: 'Cold staging wallet', ref: '0xa441…0e9d', host: 'Exchange B', state: 'Armed', deployed: 'Sep 22', hits: 0, lastHit: '—', commit: '0x33c0…ab17', lure: 0.74 },
  { id: 'DW-02', type: 'Wallet', label: 'Exchange A legacy hot', ref: '0x10f3…77b2', host: 'Exchange A', state: 'Retired', deployed: 'Jun 03', hits: 1, lastHit: 'Aug 14', commit: '0x9c4e…0f38', lure: 0.4 },
]

export const VAULTS = [
  { id: 'hot', name: 'Hot Vault', addr: '0x6b1e…a30c', balance: '1,280 ETH', usd: '$3.33M', quota: 0, quotaMax: '2,400 ETH / 24h', state: 'Tightened', timelock: 'none', restriction: 'Quota cleared · sweep executed', level: 3 },
  { id: 'warm', name: 'Warm Vault', addr: '0x2d74…11b9', balance: '18,400 ETH', usd: '$47.8M', quota: 0.4, quotaMax: '6,000 ETH / 24h', state: 'Restricted', timelock: '6h freeze', restriction: 'Cosign-only until 20:02 UTC', level: 2 },
  { id: 'cold', name: 'Cold Vault', addr: '0xe90a…5f42', balance: '1.84M ETH', usd: '$4.77B', quota: 0.85, quotaMax: 'Release via timelock only', state: 'Delayed', timelock: '72h (was 24h)', restriction: 'Timelock extended +48h', level: 1 },
] as const

export const WORKFLOWS = [
  {
    id: 'trap', name: 'Trap Workflow', trigger: 'Event-driven · decoy touch', status: 'Triggered', last: '14:02:19', runs24: 2, p50: '11.8s',
    checks: ['Decoy touch event matches DecoyCommit commitment', 'Onchain transfer evidence independently re-fetched by each node', 'Attacker address not already in ThreatRegistry'],
    inputs: ['DW-07 transfer · blk 21,904,118', 'DA-114 enumeration logs (hash)', 'DecoyCommit 0xc71d…0a92'],
    outputs: ['Tightening report #78452 → QuorumReceiver', 'ThreatRegistry entry #4,118'],
    conclusion: 'High-confidence trap hit · tighten Exchange A vaults', cases: ['QRM-78452'],
  },
  {
    id: 'cosign', name: 'Cosign Workflow', trigger: 'Per request · RequestBoard', status: 'Running', last: '14:02:41', runs24: 9412, p50: '2.4s',
    checks: ['User intent signature', 'QuorumVault quota bucket + hidden threshold band', 'Destination vs ThreatRegistry', 'Multichain balance reconciliation'],
    inputs: ['RequestBoard entries', 'ThreatRegistry snapshot', 'Vault policy (ConfigTimelock)'],
    outputs: ['APPROVE / REJECT / PENDING verdict', 'Execution permit → QuorumReceiver'],
    conclusion: '9,396 approve · 12 pending · 4 reject (24h)', cases: ['QRM-78452', 'QRM-78431'],
  },
  {
    id: 'patrol', name: 'Patrol Workflow', trigger: 'Cron · every 30s', status: 'Running', last: '14:02:30', runs24: 2880, p50: '6.1s',
    checks: ['Vault flow vs quota replenishment', 'Cross-chain reconciliation (6 chains)', 'Post-trigger tracking of flagged clusters', 'Registry propagation acknowledgements'],
    inputs: ['Vault events', 'Bridge + DEX traces', 'Member ack receipts'],
    outputs: ['Flow anomaly reports', 'Retro-links to open cases', 'Quota replenish permits'],
    conclusion: 'Tracking 0x3a4f cluster · 2 hops · no outflow', cases: ['QRM-78452'],
  },
] as const

export const RUNS = [
  { id: 'run-7f21', wf: 'Trap', t: '14:02:19', dur: '11.6s', nodes: '7/7', result: 'Tighten', ref: 'report #78452', state: 'Verified' },
  { id: 'run-7f20', wf: 'Patrol', t: '14:02:30', dur: '5.8s', nodes: '7/7', result: 'Cluster tracked', ref: 'trace #2290', state: 'Verified' },
  { id: 'run-7f1e', wf: 'Cosign', t: '14:02:03', dur: '2.1s', nodes: '7/7', result: 'REJECT', ref: 'RB-310944', state: 'Verified' },
  { id: 'run-7f1d', wf: 'Cosign', t: '14:01:58', dur: '2.7s', nodes: '7/7', result: 'PENDING', ref: 'RB-310943', state: 'Verified' },
  { id: 'run-7f19', wf: 'Patrol', t: '14:02:00', dur: '6.2s', nodes: '6/7', result: 'Anomaly · flow', ref: 'trace #2289', state: 'Partial' },
  { id: 'run-7f12', wf: 'Cosign', t: '14:00:12', dur: '1.9s', nodes: '7/7', result: 'APPROVE', ref: 'RB-310938', state: 'Verified' },
  { id: 'run-7e88', wf: 'Trap', t: '13:40:03', dur: '12.4s', nodes: '7/7', result: 'Tighten', ref: 'Kestrel #4,117', state: 'Verified' },
]

export const THREATS = [
  { id: '#4,118', addr: '0x7a3f…91c2', fp: 'decoy-wallet-touch · enum→probe→transfer', conf: 'Deterministic', nodes: '7/7', source: 'Exchange A', scope: 'Network-wide', consumed: 36, of: 38, seen: '14:02:07', case: 'QRM-78452', state: 'Confirmed' },
  { id: '#4,117', addr: '0x91c2…a0d4', fp: 'decoy-credential · canary seed read', conf: 'Deterministic', nodes: '7/7', source: 'Kestrel Custody', scope: 'Network-wide', consumed: 38, of: 38, seen: '13:40:03', case: 'QRM-78431', state: 'Confirmed' },
  { id: '#4,116', addr: '0xbe20…44e1', fp: 'cluster-retro-link · 2 hops from #4,118', conf: 'Patrol-linked', nodes: '6/7', source: 'Patrol', scope: 'Members opted-in', consumed: 21, of: 38, seen: '14:02:30', case: 'QRM-78452', state: 'Review' },
  { id: '#4,109', addr: '0x7c00…12aa', fp: 'decoy-threshold · probe at 49.9 ETH', conf: 'Deterministic', nodes: '7/7', source: 'Exchange B', scope: 'Network-wide', consumed: 38, of: 38, seen: 'Oct 03', case: 'QRM-78390', state: 'Confirmed' },
  { id: '#4,094', addr: '0x0e8a…f3c1', fp: 'decoy-api · legacy key replay', conf: 'Deterministic', nodes: '7/7', source: 'Meridian DAO', scope: 'Network-wide', consumed: 38, of: 38, seen: 'Sep 29', case: 'QRM-78301', state: 'Expired' },
]

export const MEMBERS = [
  { id: 'exA', name: 'Exchange A', kind: 'Exchange', state: 'Tightened', ack: '14:02:31', level: 0.96, x: -2.05, y: 0, enf: true, alert: 'Decoy DW-07 touched', note: 'Source member · incident origin · vaults tightened' },
  { id: 'exB', name: 'Exchange B', kind: 'Exchange', state: 'Consumed', ack: '14:02:44', level: 0.9, x: 1, y: -1, enf: true, alert: 'Match on 0x7a3f…91c2', note: 'Registry match · stricter Cosign review' },
  { id: 'kes', name: 'Kestrel Custody', kind: 'Custodian', state: 'Consumed', ack: '14:02:46', level: 0.88, x: -1, y: -1, enf: true, alert: 'Blocklist #4,118', note: 'Blocklist synced' },
  { id: 'mer', name: 'Meridian DAO', kind: 'DAO treasury', state: 'Consumed', ack: '14:02:51', level: 0.82, x: -1, y: 1, enf: true, alert: 'Guarded proposal', note: 'Proposal guard armed' },
  { id: 'sab', name: 'Sable Agents', kind: 'AI-agent wallets', state: 'Consumed', ack: '14:02:49', level: 0.8, x: 1, y: 1, enf: true, alert: 'Agent scope narrowed', note: 'Agent spend scope narrowed' },
  { id: 'orb', name: 'Orbit Exchange', kind: 'Exchange', state: 'Pending', ack: '—', level: 0.64, x: 2, y: 0, enf: false, alert: 'Ack overdue', note: 'Ack overdue · 2 Patrol retries' },
  { id: 'vel', name: 'Vela Prime', kind: 'Prime broker', state: 'Received', ack: '14:03:02', level: 0.7, x: 0, y: 1.35, enf: false, alert: 'Apply queued', note: 'Received · policy apply queued' },
]

export const CONFIG_CHANGES = [
  { id: 'CT-0192', t: 'Oct 05 14:02', key: 'hot.quota', from: '2,400 ETH', to: '0 ETH', by: 'Trap Workflow (CRE)', path: 'Tighten fast-path · no delay', state: 'Applied' },
  { id: 'CT-0193', t: 'Oct 05 14:02', key: 'cold.timelock', from: '24h', to: '72h', by: 'Trap Workflow (CRE)', path: 'Tighten fast-path · no delay', state: 'Applied' },
  { id: 'CT-0194', t: 'Oct 05 14:15', key: 'hot.quota', from: '0 ETH', to: '800 ETH', by: 'M. Kovač + J. Ruiz', path: 'Relax · 48h ConfigTimelock', state: 'Queued' },
  { id: 'CT-0188', t: 'Oct 02 09:40', key: 'cosign.band2.upper', from: '40 ETH', to: '36 ETH (rotated)', by: 'Rotation schedule', path: 'Hidden threshold rotation', state: 'Applied' },
  { id: 'CT-0185', t: 'Sep 30 17:22', key: 'decoy.DX-21', from: '—', to: 'deployed', by: 'A. Osei', path: 'DecoyCommit + 24h', state: 'Applied' },
  { id: 'CT-0179', t: 'Sep 27 11:05', key: 'warm.freeze.max', from: '12h', to: '6h', by: 'J. Ruiz', path: 'Relax · 48h ConfigTimelock', state: 'Rejected' },
]

export const REPORTS = [
  { id: 'R-2210', title: 'Incident report · #QRM-78452', kind: 'Case report', period: 'Oct 05', pages: 14, state: 'Draft' },
  { id: 'R-2209', title: 'Onchain action summary · week 40', kind: 'Onchain actions', period: 'Sep 29 – Oct 05', pages: 6, state: 'Verified' },
  { id: 'R-2205', title: 'CRE workflow run log · September', kind: 'Workflow logs', period: 'Sep 2026', pages: 42, state: 'Verified' },
  { id: 'R-2201', title: 'ConfigTimelock change history · Q3', kind: 'Change history', period: 'Jul – Sep', pages: 9, state: 'Verified' },
  { id: 'R-2198', title: 'SOC 2 evidence pack · withdrawal controls', kind: 'Compliance', period: 'Q3 2026', pages: 31, state: 'Verified' },
  { id: 'R-2190', title: 'Network propagation response · #4,109', kind: 'Response summary', period: 'Oct 03', pages: 4, state: 'Verified' },
]
