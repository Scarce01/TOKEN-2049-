import { expect, test } from 'bun:test'
import { type Ev, judge } from '../src/api/angles'

const env = { fork: true, chainId: 84532, orgCount: 2, cusumH: 5000n }
const ev = (event: string, args: Record<string, unknown> = {}, org: string | null = 'A', block = 10): Ev => ({
  block,
  time: block * 2,
  tx: `0x${String(block).padStart(64, '0')}`,
  contract: 'X',
  org,
  event,
  args,
})

test('a trapped attack: CRE, network flag; flow clear; NOWNodes not applicable on a fork', () => {
  const tok = '0x07'
  const window = [
    ev('FreezeSet'),
    ev('QuotaZeroed'),
    ev('AlertSet', { level: '4' }),
    ev('ThreatAdded', { reporterOrg: '0xa' }),
    ev('PatrolStateUpdated', { S: '120', alarm: false }, 'A', 12),
    ev('AssetCheckpoint', { token: tok, assetValue: '500' }, 'A', 13),
  ]
  const before = [ev('AssetCheckpoint', { token: tok, assetValue: '500' }, 'A', 5)]
  const r = judge('A', window, before, env)
  const s = Object.fromEntries(r.angles.map((a) => [a.key, a.status]))
  expect(s).toEqual({ cre: 'flag', nownodes: 'na', flow: 'clear', assets: 'clear', network: 'flag' })
  expect(r.verdict).toBe('2 of 4 independent angles flag this attack')
  expect(r.angles[0]!.summary).toContain('alert CONFIRMED')
  expect(r.angles.find((a) => a.key === 'nownodes')!.summary).toContain('Local fork')
})

test('no data: every angle says na or clear, never flag; a falling asset value flags', () => {
  const empty = judge('A', [], [], env)
  expect(empty.angles.every((a) => a.status !== 'flag')).toBe(true)
  const fell = judge(
    'A',
    [
      ev('AssetCheckpoint', { token: '0x1', assetValue: '90' }, 'A', 20),
      ev('PatrolStateUpdated', { S: '6000', alarm: true }, 'A', 21),
    ],
    [ev('AssetCheckpoint', { token: '0x1', assetValue: '100' }, 'A', 1)],
    { ...env, fork: false },
  )
  const s = Object.fromEntries(fell.angles.map((a) => [a.key, a.status]))
  expect(s.assets).toBe('flag')
  expect(s.flow).toBe('flag')
  expect(fell.angles.find((a) => a.key === 'nownodes')!.summary).toContain('No NOWNodes access')
})

test('events of another org do not count for this one, except the shared registry', () => {
  const r = judge('A', [ev('AlertSet', { level: '4' }, 'B'), ev('ThreatAdded', {}, 'B')], [], env)
  const s = Object.fromEntries(r.angles.map((a) => [a.key, a.status]))
  expect(s.cre).toBe('clear')
  expect(s.network).toBe('flag')
})
