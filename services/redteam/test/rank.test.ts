import { describe, expect, test } from 'bun:test'
import { assertLocalExchange, assertSepoliaTarget } from '../src/guard'
import { formatRanking, rankWallets, selectTarget, type VisibleWallet } from '../src/rank'
import { parseVisibleWallet } from '../src/scanner'

function wallet(partial: Partial<VisibleWallet> & Pick<VisibleWallet, 'address' | 'balance'>): VisibleWallet {
  return {
    label: 'ops-sweeper-01',
    chain: 'ethereum-sepolia',
    kind: 'eoa',
    status: 'active',
    ...partial,
  }
}

describe('ranking', () => {
  test('picks the eoa with the highest balance and ignores labels', () => {
    const fat = wallet({
      address: '0x00000000000000000000000000000000000000c0',
      balance: '49000000',
      label: 'ops-sweeper-04',
    })
    const legacy = wallet({
      address: '0x00000000000000000000000000000000000000b0',
      balance: '12000000',
      label: 'hot-legacy-01',
    })
    const vault = wallet({
      address: '0x00000000000000000000000000000000000000a0',
      balance: '999000000',
      kind: 'vault',
      label: 'hot-vault',
    })
    const dust = wallet({ address: '0x00000000000000000000000000000000000000d0', balance: '1' })
    const ranked = rankWallets([legacy, vault, dust, fat])
    expect(ranked.map((r) => r.address)).toEqual([fat.address, legacy.address])
    expect(selectTarget([legacy, vault, dust, fat]).address).toBe(fat.address)
    expect(formatRanking(ranked)).toContain(`#1 ${fat.address}`)
    expect(formatRanking(ranked)).not.toContain('privateKey')
  })

  test('a mid balance ranks third', () => {
    const rows = [
      wallet({ address: '0x0000000000000000000000000000000000000005', balance: '37000000', label: 'n5' }),
      wallet({ address: '0x0000000000000000000000000000000000000003', balance: '49000000', label: 'mid' }),
      wallet({ address: '0x0000000000000000000000000000000000000001', balance: '65000000', label: 'n1' }),
      wallet({ address: '0x0000000000000000000000000000000000000004', balance: '43000000', label: 'n4' }),
      wallet({ address: '0x0000000000000000000000000000000000000002', balance: '55000000', label: 'n2' }),
    ]
    expect(rankWallets(rows).map((r) => r.label)).toEqual(['n1', 'n2', 'mid', 'n4', 'n5'])
  })

  test('ties break by address', () => {
    const a = wallet({ address: '0x000000000000000000000000000000000000000b', balance: '2000000' })
    const b = wallet({ address: '0x000000000000000000000000000000000000000a', balance: '2000000' })
    expect(rankWallets([a, b]).map((r) => r.address)).toEqual([b.address, a.address])
  })
})

describe('visible rows', () => {
  test('rejects a marker field', () => {
    expect(() =>
      parseVisibleWallet({
        label: 'a',
        chain: 'c',
        address: '0x1',
        kind: 'eoa',
        status: 'active',
        balance: '1',
        isDecoy: true,
      }),
    ).toThrow('unexpected wallet field')
  })

  test('rejects a private key field', () => {
    expect(() =>
      parseVisibleWallet({
        label: 'a',
        chain: 'c',
        address: '0x1',
        kind: 'eoa',
        status: 'active',
        balance: '1',
        privateKey: `0x${'11'.repeat(32)}`,
      }),
    ).toThrow('unexpected wallet field privateKey')
  })
})

describe('targets', () => {
  test('refuses a remote exchange and a non-sepolia rpc', () => {
    expect(() => assertLocalExchange('https://api.binance.com')).toThrow('local exchange-api')
    expect(() => assertSepoliaTarget(1, 'https://eth.llamarpc.com')).toThrow('ethereum sepolia')
    expect(() => assertSepoliaTarget(11155111, 'https://bsc-dataseed.binance.org')).toThrow('refusing')
    expect(assertLocalExchange('http://127.0.0.1:8787').hostname).toBe('127.0.0.1')
  })
})
