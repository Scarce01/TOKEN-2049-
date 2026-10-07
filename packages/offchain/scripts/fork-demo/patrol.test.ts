import { expect, test } from 'bun:test'
import { dueHandlers, indexOf } from './patrol'

test('first tick runs everything; later ticks follow the sim-runner cadence', () => {
  expect(dueHandlers(1, true)).toEqual(['decoys', 'reconcile', 'quota', 'epoch', 'ping'])
  expect(dueHandlers(2, true)).toEqual(['decoys', 'reconcile', 'quota'])
  expect(dueHandlers(11, true)).toEqual(['decoys', 'reconcile', 'quota', 'ping'])
  expect(dueHandlers(61, false)).toEqual(['reconcile', 'quota', 'epoch', 'ping'])
})

test('trigger indices match the workflow', () => {
  expect(['ping', 'decoys', 'epoch', 'quota', 'reconcile'].map((h) => indexOf(h as never))).toEqual([0, 1, 2, 3, 4])
})
