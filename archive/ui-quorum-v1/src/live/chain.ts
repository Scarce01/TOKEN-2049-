// Live backend reads for the Quorum fork (docs: D:/Token 2049). Public chain state only; decoy/trap data
// stays officer-only (CLAUDE.md rule 2) and is not read here. Falls back silently so the design still demos.
import { useEffect, useState } from 'react'
import { createPublicClient, formatUnits, http, parseAbi, type Address } from 'viem'

export const RPC = (import.meta.env.VITE_RPC_URL as string) ?? 'http://127.0.0.1:8545'

// base-sepolia-fork.json (addresses are public)
export const D = {
  chainId: 84532,
  qUSD: '0x057D286e76AA117de72f4A70234bE0DAE211f0c4',
  qETH: '0x36E7E10524504f8aC2BF126A4Ea839251510dCd9',
  threatRegistry: '0xA9a3109fD268137DAfB4746718874cF717a753fa',
  requestBoard: '0x6556DE23546F561d1b737bd4021F7e09305E51C1',
  orgA: {
    receiver: '0xd677e3235F9CD1D639a7e981d7C250E9D39Fa16C',
    hot: '0x4b2c775EEA01224623a4455c5e5bEdA18Fa5F031',
    warm: '0x29a6Ed3AAE203B7FE96d5C8075bb94686D4550ac',
    cold: '0x7AC19d41C17E7eA70e2753B7fEF6bacc86Fd5Def',
  },
  orgB: {
    receiver: '0x5dC19B4954b6331a3b7fB05b5b09f8284b626E0C',
    hot: '0xb6671Cab9A07D6366A46F2304a8c09565a8c3A16',
    warm: '0x7666798eBCCa3A3380c6AcB4c7DDcE923C8E0E7b',
    cold: '0x8834EF4a48eb7957c4BC8aBec6E69cb79b7970C0',
  },
} as const

const client = createPublicClient({ transport: http(RPC) })

const receiverAbi = parseAbi([
  'function alert() view returns (uint8)',
  'function alertExpiresAt() view returns (uint64)',
  'function frozenUntil(address) view returns (uint64)',
  'function mode() view returns (uint8)',
  'function lastPing() view returns (bytes32)',
])
const vaultAbi = parseAbi([
  'function quota(address) view returns (uint256)',
  'function cap(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function hourCap(address) view returns (uint256)',
  'function dayCap(address) view returns (uint256)',
])
const coldAbi = parseAbi(['function delay() view returns (uint64)'])
const threatAbi = parseAbi(['function activeConfirmedCount() view returns (uint256)'])

export const ALERT = ['Normal', 'L1', 'L2', 'L3', 'CONFIRMED'] as const

export type TokenAmt = { qUSD: number; qETH: number }
export type LiveVault = {
  id: 'hot' | 'warm' | 'cold'
  address: Address
  balance: TokenAmt
  quota?: TokenAmt
  cap?: TokenAmt
  hourCap?: TokenAmt
  dayCap?: TokenAmt
  frozenUntil?: number
  coldDelayHours?: number
}
export type LiveOrg = {
  key: 'a' | 'b'
  receiver: Address
  alert: number
  alertLabel: string
  alertExpiresAt: number
  mode: 'SIM' | 'PROD'
  lastPing: string
  vaults: LiveVault[]
}
export type Live = { orgs: LiveOrg[]; activeConfirmed: number; block: number; at: number }

const n6 = (x: bigint) => Number(formatUnits(x, 6))
const n18 = (x: bigint) => Number(formatUnits(x, 18))
const amt = (usd: bigint, eth: bigint): TokenAmt => ({ qUSD: n6(usd), qETH: n18(eth) })

async function readOrg(key: 'a' | 'b', o: (typeof D)['orgA']): Promise<LiveOrg> {
  const r = (fn: string, address: Address, args: unknown[] = [], abi = receiverAbi) =>
    client.readContract({ address, abi: abi as never, functionName: fn as never, args: args as never })
  const [alert, alertExp, hotFroze, warmFroze, mode, lastPing, coldDelay] = await Promise.all([
    r('alert', o.receiver),
    r('alertExpiresAt', o.receiver),
    r('frozenUntil', o.receiver, [o.hot]),
    r('frozenUntil', o.receiver, [o.warm]),
    r('mode', o.receiver),
    r('lastPing', o.receiver),
    r('delay', o.cold, [], coldAbi),
  ])
  const vbal = async (v: Address) =>
    amt(
      (await r('balanceOf', v, [D.qUSD], vaultAbi)) as bigint,
      (await r('balanceOf', v, [D.qETH], vaultAbi)) as bigint,
    )
  const vq = async (v: Address, fn: string) =>
    amt((await r(fn, v, [D.qUSD], vaultAbi)) as bigint, (await r(fn, v, [D.qETH], vaultAbi)) as bigint)
  const vaults: LiveVault[] = [
    {
      id: 'hot',
      address: o.hot,
      balance: await vbal(o.hot),
      quota: await vq(o.hot, 'quota'),
      cap: await vq(o.hot, 'cap'),
      hourCap: await vq(o.hot, 'hourCap'),
      dayCap: await vq(o.hot, 'dayCap'),
      frozenUntil: Number(hotFroze),
    },
    {
      id: 'warm',
      address: o.warm,
      balance: await vbal(o.warm),
      quota: await vq(o.warm, 'quota'),
      cap: await vq(o.warm, 'cap'),
      frozenUntil: Number(warmFroze),
    },
    { id: 'cold', address: o.cold, balance: await vbal(o.cold), coldDelayHours: Number(coldDelay) / 3600 },
  ]
  return {
    key,
    receiver: o.receiver,
    alert: Number(alert),
    alertLabel: ALERT[Number(alert)] ?? 'Normal',
    alertExpiresAt: Number(alertExp),
    mode: Number(mode) === 0 ? 'PROD' : 'SIM',
    lastPing: String(lastPing),
    vaults,
  }
}

export async function readLive(): Promise<Live> {
  const [block, orgA, orgB, confirmed] = await Promise.all([
    client.getBlockNumber(),
    readOrg('a', D.orgA),
    readOrg('b', D.orgB),
    client.readContract({ address: D.threatRegistry, abi: threatAbi, functionName: 'activeConfirmedCount' }),
  ])
  return { orgs: [orgA, orgB], activeConfirmed: Number(confirmed), block: Number(block), at: Date.now() }
}

/** ThreatRegistry.ThreatAdded log history (network-wide suspect list). */
export async function readThreats() {
  const logs = await client.getLogs({
    address: D.threatRegistry,
    event: parseAbi([
      'event ThreatAdded(address indexed suspect, bytes32 indexed evidenceHash, bytes32 fingerprintHash, bytes32 reporterOrg, uint64 expiresAt, uint32 count, bytes32 parentEvidence)',
    ])[0],
    fromBlock: 'earliest',
  })
  return logs.map((l) => ({
    suspect: l.args.suspect as string,
    evidenceHash: l.args.evidenceHash as string,
    reporterOrg: l.args.reporterOrg as string,
    expiresAt: Number(l.args.expiresAt ?? 0n),
    count: Number(l.args.count ?? 0),
    parent: (l.args.parentEvidence as string) !== `0x${'0'.repeat(64)}`,
  }))
}

export type LiveState<T> = { data?: T; error?: string; loading: boolean }

export function useLive<T>(fn: () => Promise<T>, ms = 5000): LiveState<T> {
  const [s, setS] = useState<LiveState<T>>({ loading: true })
  useEffect(() => {
    let on = true
    const run = () =>
      fn()
        .then((data) => on && setS({ data, loading: false }))
        .catch((e) => on && setS((p) => ({ ...p, error: String(e?.message ?? e), loading: false })))
    run()
    const t = setInterval(run, ms)
    return () => {
      on = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return s
}
