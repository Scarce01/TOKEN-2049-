import { describe, expect, test } from 'bun:test'
import {
  canonicalReceipt,
  nownodesUrlFor,
  receiptRequestBody,
  secondSourceAvailable,
  secondSourceHasLog,
  secondSourceVerdict,
  summarizeSecondSource,
  UNAVAILABLE,
} from '../src/logic/nownodes'

const TOKEN = '0x6666666666666666666666666666666666666666'
const TOPIC0 = `0x${'11'.repeat(32)}`
const TOPIC1 = `0x${'22'.repeat(32)}`
const TOPIC2 = `0x${'33'.repeat(32)}`
const DATA = `0x${'44'.repeat(32)}`

const log = { address: TOKEN, topics: [TOPIC0, TOPIC1, TOPIC2], data: DATA, index: 3 }

function body(status: string, logs: unknown[] | null, error?: { code: number }) {
  if (error) return JSON.stringify({ jsonrpc: '2.0', id: 1, error })
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: logs === null ? null : { status, logs },
  })
}

const oneLog = {
  address: TOKEN.toUpperCase(),
  topics: [TOPIC0, TOPIC1, TOPIC2],
  data: DATA,
  logIndex: '0x3',
}

describe('nownodes receipt', () => {
  test('request body is eth_getTransactionReceipt for that hash', () => {
    const tx = `0x${'ab'.repeat(32)}`
    expect(JSON.parse(receiptRequestBody(tx))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [tx],
    })
  })

  test('a status-1 receipt that contains the trigger log agrees', () => {
    const canonical = canonicalReceipt(body('0x1', [oneLog, { ...oneLog, logIndex: '0x1', data: '0x01' }]))
    expect(secondSourceHasLog(canonical, log)).toBe(true)
    expect(summarizeSecondSource(canonical)).toBe('status=1 logs=2')
  })

  test('reverted receipt does not agree', () => {
    const canonical = canonicalReceipt(body('0x0', [oneLog]))
    expect(secondSourceHasLog(canonical, log)).toBe(false)
    expect(summarizeSecondSource(canonical)).toBe('status=0 logs=1')
  })

  test('a different log index does not agree', () => {
    const canonical = canonicalReceipt(body('0x1', [{ ...oneLog, logIndex: '0x4' }]))
    expect(secondSourceHasLog(canonical, log)).toBe(false)
  })

  test('null receipt is a miss', () => {
    expect(canonicalReceipt(body('0x1', null))).toBe('miss')
    expect(secondSourceHasLog('miss', log)).toBe(false)
  })

  test('json-rpc error and non-json throw', () => {
    expect(() => canonicalReceipt(body('0x1', [], { code: -32000 }))).toThrow('nownodes rpc -32000')
    expect(() => canonicalReceipt('<html>404</html>')).toThrow('nownodes body is not json')
  })
})

describe('nownodes endpoint per chain (audit H1/H2)', () => {
  test('Ethereum Sepolia has an endpoint; other chains have none', () => {
    expect(nownodesUrlFor(11155111)).toBe('https://eth-sepolia.nownodes.io')
    expect(nownodesUrlFor(84532)).toBe('')
  })
  test('an empty endpoint means the second source is skipped (advisory), not a veto', () => {
    expect(secondSourceAvailable('')).toBe(false)
    expect(secondSourceAvailable('https://eth-sepolia.nownodes.io')).toBe(true)
  })
})

describe('second source verdict (audit H2, D48)', () => {
  test('a receipt with the trigger log matches', () => {
    expect(secondSourceVerdict(canonicalReceipt(body('0x1', [oneLog])), log)).toBe('match')
  })
  test('a receipt that disagrees is a contradiction: D48, no action', () => {
    expect(secondSourceVerdict(canonicalReceipt(body('0x0', [oneLog])), log)).toBe('contradiction')
    expect(secondSourceVerdict(canonicalReceipt(body('0x1', [{ ...oneLog, logIndex: '0x4' }])), log)).toBe(
      'contradiction',
    )
    expect(secondSourceVerdict(canonicalReceipt(body('0x1', [{ ...oneLog, data: '0x01' }])), log)).toBe('contradiction')
  })
  test('null receipt (NOWNodes behind) or a failed lookup is unavailable, never a veto', () => {
    expect(secondSourceVerdict(canonicalReceipt(body('0x1', null)), log)).toBe('unavailable')
    expect(secondSourceVerdict(UNAVAILABLE, log)).toBe('unavailable')
  })
})
