import { describe, expect, test } from 'bun:test'
import {
  ATTACKER_HOT_WALLET_FIELDS,
  type AttackerHotWallet,
  parseProbeBody,
  toAttackerHotWallet,
} from '../src/hot-wallet-view'

const BANNED = ['isdecoy', 'honeypot', 'securitylabel', 'decoy', 'trap', 'privatekey']

describe('attacker hot wallet view', () => {
  test('returns only the public field list', () => {
    const raw = {
      label: 'ops-sweeper-01',
      chain: 'ethereum-sepolia',
      address: '0x0000000000000000000000000000000000000001',
      kind: 'eoa',
      status: 'active',
      balance: '1000000',
      privateKey: `0x${'ab'.repeat(32)}`,
      isDecoy: true,
      trap: 'x',
      honeypot: true,
      securityLabel: 'hidden',
    }
    const row = toAttackerHotWallet(raw as AttackerHotWallet)
    expect(Object.keys(row)).toEqual([...ATTACKER_HOT_WALLET_FIELDS])
    const blob = JSON.stringify(row).toLowerCase()
    for (const word of BANNED) expect(blob.includes(word)).toBe(false)
  })
})

describe('probe body', () => {
  test('accepts a 1 qUSD transfer and refuses anything else', () => {
    const ok = parseProbeBody({
      address: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      amount: '1000000',
    })
    expect(ok.amount).toBe(1_000_000n)
    expect(() => parseProbeBody({ ...ok, amount: '500000000' })).toThrow('amount')
    expect(() => parseProbeBody({ address: 'nope', to: ok.to, amount: '1000000' })).toThrow('address')
  })
})
