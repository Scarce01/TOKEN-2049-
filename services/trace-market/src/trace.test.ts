import { expect, test } from 'bun:test'
import { trace } from './trace'

test('C07 every linked address carries its evidence tx and parent', () => {
  const out = trace('0x47666Fab8bd0Ac7003bce3f5C3585383F09486E2')! // Bybit seed A (public, FBI-listed)
  expect(out.traceCase).toBe('bybit-2025-02')
  expect(out.linked.length).toBeGreaterThan(0)
  for (const l of out.linked) {
    expect(l.evidenceTx).toMatch(/^0x[0-9a-f]{64}$/)
    expect(l.confidence).toBe('LINKED')
  }
  expect(out.linked[0]!.from).toBe(out.seed)
})

test('unknown address -> null (route answers 404, x402 does not settle)', () => {
  expect(trace('0x0000000000000000000000000000000000000001')).toBeNull()
})
