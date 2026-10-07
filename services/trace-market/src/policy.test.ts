import { expect, test } from 'bun:test'
import { UNIT, decide } from './policy'

test('C06 spend policy', () => {
  expect(decide(UNIT, 'LINKED')).toBe('auto')
  expect(decide(5n * UNIT, 'CONFIRMED')).toBe('auto')
  expect(decide(5n * UNIT, 'LINKED')).toBe('human')
  expect(decide(11n * UNIT, 'CONFIRMED')).toBe('human')
  expect(decide(1n, 'BEHAVIOR')).toBe('refuse')
})
