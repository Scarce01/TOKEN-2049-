export type NodeId = 'board' | 'threat' | 'exA' | 'exB' | 'decoy' | 'core' | 'receiver' | 'registry' | 'hot' | 'warm' | 'cold'

/** Architecture layer each structure belongs to */
export type Layer = 'entry' | 'trap' | 'cre' | 'exec' | 'vault' | 'intel' | 'network'
export type Size = 'lg' | 'md' | 'sm'

export type HiveNode = {
  id: NodeId; name: string; kind: string; x: number; z: number
  status: string; event: string; restriction: string
  layer: Layer; size: Size
  /** step (1–7) at which this structure becomes engaged */
  phase: number
}

export const NODES: HiveNode[] = [
  { id: 'threat', name: 'External Threat', kind: '0x7a3f…91c2 · outside border', x: -15, z: 9, phase: 1, layer: 'entry', size: 'md', status: 'Flagged in ThreatRegistry', event: 'Probe withdrawal 0.42 ETH → decoy address', restriction: 'Blocklisted network-wide' },
  { id: 'exA', name: 'Bybit', kind: 'Backend untrusted', x: -9.4, z: -4.2, phase: 1, layer: 'entry', size: 'md', status: 'Incident source', event: 'Backend submitted 3 requests', restriction: 'Request-only · not an authority' },
  { id: 'board', name: 'RequestBoard', kind: 'Records · cannot move funds', x: -4.2, z: -9.2, phase: 1, layer: 'entry', size: 'sm', status: '3 requests held', event: 'RB-310944 rejected · RB-310943 escalated', restriction: 'Ledger only' },
  { id: 'decoy', name: 'Decoy Chamber', kind: 'Decoy wallet · DW-07', x: -7, z: 6, phase: 2, layer: 'trap', size: 'md', status: 'Triggered', event: 'Transfer to decoy · blk 21,904,118', restriction: 'High-confidence trap' },
  { id: 'core', name: 'Quorum Core', kind: 'CRE DON · 7 nodes', x: 0, z: 0, phase: 3, layer: 'cre', size: 'lg', status: 'Trap verified 7/7', event: 'Trap Workflow signed 14:02:19 UTC', restriction: 'Verifies · never holds funds' },
  { id: 'receiver', name: 'QuorumReceiver', kind: 'Executes CRE reports', x: 5.2, z: -2.0, phase: 4, layer: 'exec', size: 'sm', status: 'Report #78452 executed', event: 'applyTightening() · 4 calls', restriction: 'Accepts DON-signed reports only' },
  { id: 'hot', name: 'Hot Vault', kind: 'QuorumVault · operational', x: 6.4, z: 5.0, phase: 5, layer: 'vault', size: 'md', status: 'Quota 0', event: '2,400 → 0 ETH · 1,120 ETH swept to cold', restriction: 'Blocked · 0% quota' },
  { id: 'warm', name: 'Warm Vault', kind: 'QuorumVault · semi-protected', x: 10.6, z: -0.6, phase: 5, layer: 'vault', size: 'md', status: 'Cosign-only 6h', event: 'Restricted until 20:02 UTC', restriction: 'Restricted · 40% flow' },
  { id: 'cold', name: 'Cold Vault', kind: 'ColdVault · deep storage', x: 11.8, z: 5.6, phase: 5, layer: 'vault', size: 'md', status: 'Timelock 72h', event: 'Timelock 24h → 72h', restriction: 'Delayed · +48h' },
  { id: 'registry', name: 'ThreatRegistry', kind: 'Shared intelligence', x: 4.6, z: -8.8, phase: 6, layer: 'intel', size: 'sm', status: 'Entry #4,118', event: '0x7a3f…91c2 published', restriction: 'Read by 38 members' },
  { id: 'exB', name: 'Bitget', kind: 'Network member', x: 9.2, z: -10.0, phase: 7, layer: 'network', size: 'md', status: 'Alert received', event: 'Matched 0x7a3f…91c2 · quota −60%', restriction: 'Precautionary tightening' },
]

/** request = untrusted intake · attack/probe = adversary · verify = evidence into CRE · exec = signed report → contracts · intel = shared threat data */
export type EdgeKind = 'attack' | 'probe' | 'request' | 'verify' | 'exec' | 'intel'
export const EDGES: { from: NodeId; to: NodeId; phase: number; kind: EdgeKind }[] = [
  { from: 'threat', to: 'exA', phase: 1, kind: 'probe' },
  { from: 'exA', to: 'board', phase: 1, kind: 'request' },
  { from: 'board', to: 'core', phase: 1, kind: 'request' },
  { from: 'threat', to: 'decoy', phase: 2, kind: 'attack' },
  { from: 'decoy', to: 'core', phase: 3, kind: 'verify' },
  { from: 'core', to: 'receiver', phase: 4, kind: 'exec' },
  { from: 'receiver', to: 'hot', phase: 5, kind: 'exec' },
  { from: 'receiver', to: 'warm', phase: 5, kind: 'exec' },
  { from: 'receiver', to: 'cold', phase: 5, kind: 'exec' },
  { from: 'receiver', to: 'registry', phase: 6, kind: 'intel' },
  { from: 'registry', to: 'exB', phase: 7, kind: 'intel' },
  { from: 'registry', to: 'exA', phase: 7, kind: 'intel' },
]

export const TRAP_CHAIN: NodeId[] = ['threat', 'decoy', 'core', 'receiver', 'hot', 'warm', 'cold', 'registry', 'exB']

/** Separable architecture paths for "Show system flow" */
export const PATHS: { id: string; label: string; nodes: NodeId[] }[] = [
  { id: 'request', label: 'Request path', nodes: ['exA', 'board', 'core'] },
  { id: 'trap', label: 'Trap path', nodes: ['threat', 'decoy'] },
  { id: 'verify', label: 'CRE verification', nodes: ['decoy', 'core'] },
  { id: 'exec', label: 'Execution path', nodes: ['core', 'receiver', 'hot', 'warm', 'cold'] },
  { id: 'intel', label: 'Threat propagation', nodes: ['receiver', 'registry', 'exB', 'exA'] },
]

export const STEPS: { label: string; t: string; d: string; phase: number; focus: NodeId[] }[] = [
  { label: 'Probe Observed', t: '14:01:52', d: 'Decoy enumeration from 0x3a4f…', phase: 1, focus: ['threat'] },
  { label: 'Decoy Triggered', t: '14:02:07', d: 'Decoy wallet DW-07 hit', phase: 2, focus: ['threat', 'decoy'] },
  { label: 'CRE Verified', t: '14:02:19', d: 'Trap Workflow · 7/7 nodes', phase: 3, focus: ['decoy', 'core'] },
  { label: 'QuorumReceiver Executed', t: '14:02:24', d: 'Report #78452 accepted', phase: 4, focus: ['core', 'receiver'] },
  { label: 'Vault Controls Tightened', t: '14:02:31', d: 'Hot · Warm · Cold', phase: 5, focus: ['receiver', 'hot', 'warm', 'cold'] },
  { label: 'ThreatRegistry Updated', t: '14:02:38', d: 'Entry #4,118 published', phase: 6, focus: ['receiver', 'registry'] },
  { label: 'Network Alert Shared', t: '14:02:44', d: 'Bitget + 37 members', phase: 7, focus: ['registry', 'exB'] },
]

export const EVENTS = [
  { t: '14:02:44', type: 'Network Alert', s: 'Bitget tightened on match', level: 'active' as const },
  { t: '14:02:38', type: 'ThreatRegistry Match', s: '0x7a3f…91c2 · entry #4,118', level: 'active' as const },
  { t: '14:02:31', type: 'Quota Tightening', s: 'Hot vault 2,400 → 0 ETH', level: 'warning' as const },
  { t: '14:02:07', type: 'Decoy Wallet Hit', s: 'DW-07 · Bybit', level: 'threat' as const },
  { t: '13:58:11', type: 'Suspicious Withdrawal', s: 'Cosign: PENDING · 0x91c2…a0d4', level: 'warning' as const },
  { t: '13:40:03', type: 'Network Alert', s: 'Custodian Kestrel · decoy cred', level: 'idle' as const },
]
