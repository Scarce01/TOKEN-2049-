import { describe, expect, test } from 'bun:test'
import { JobQueue, MAX_ATTEMPTS, simulateArgs } from '../src/queue'

const job = (kind: 'trap' | 'patrol' | 'cosign', key: string, t: number) => ({
  kind,
  key,
  triggerIndex: 0,
  txHash: '0xab',
  logIndex: 1,
  enqueuedAt: t,
})

describe('sim-runner queue', () => {
  test('Trap beats Patrol beats Cosign; Cosign floods cannot starve Trap', () => {
    const q = new JobQueue()
    for (let i = 0; i < 50; i++) q.push(job('cosign', `c${i}`, i))
    q.push(job('patrol', 'p', 100))
    q.push(job('trap', 't', 200))
    expect(q.next()?.kind).toBe('trap')
    expect(q.next()?.kind).toBe('patrol')
    expect(q.next()?.key).toBe('c0')
  })

  test('dedupe: marked only after success; failures retried up to a limit', () => {
    const q = new JobQueue()
    q.push(job('trap', 'x', 1))
    expect(q.push(job('trap', 'x', 2))).toBe(false)
    const j = q.next()!
    q.fail(j)
    expect(q.size).toBe(1)
    const j2 = q.next()!
    q.succeed(j2)
    expect(q.push(job('trap', 'x', 3))).toBe(false)
    let k = { ...j2, key: 'y', attempts: MAX_ATTEMPTS - 1 }
    q.fail(k)
    expect(q.size).toBe(0)
    k = { ...k }
  })

  test('simulate args keep production limits (no --limits)', () => {
    const a = simulateArgs({ ...job('trap', 'x', 0), attempts: 0 })
    expect(a).toContain('--broadcast')
    expect(a).toContain('--evm-tx-hash')
    expect(a.join(' ')).not.toContain('--limits')
  })
})
