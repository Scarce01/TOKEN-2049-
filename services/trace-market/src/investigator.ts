// QUBEE Investigator: buys a deeper trace for a case over x402 on Cardano preprod, within the spend policy.
// Usage: pnpm investigate [caseId] [CONFIRMED|LINKED|BEHAVIOR] [address]   (defaults: the Bybit replay seed)
// 1. ask without paying -> 402 with terms  2. policy  3. pay on preprod and retry -> 200 + trace  4. write evidence.
// MNEMONIC comes from .env.investigator, is used only by the signer and is never printed.
import { writeFileSync } from 'node:fs'
import { toClientCardanoSigner } from '@x402/cardano'
import { ExactCardanoScheme } from '@x402/cardano/exact/client'
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from '@x402/fetch'
import { type Classification, decide } from './policy'
import type { trace } from './trace'

const [caseId = 'bybit-2025-02', classification = 'CONFIRMED', address = '0x47666fab8bd0ac7003bce3f5c3585383f09486e2'] = process.argv.slice(2)
const mnemonic = process.env.MNEMONIC
if (!mnemonic) throw new Error('MNEMONIC missing: run pnpm wallet, then fund the payer address')
const NETWORK = 'cardano:preprod' as const
const url = `${process.env.SELLER_URL ?? 'http://localhost:4021'}/api/trace/${address}`
const EVIDENCE = new URL('../../../apps/observatory/src/data/cardano_x402.json', import.meta.url)

// lovelace is not USD-pegged, so the SDK's default spend controls refuse it: allow it, capped at the policy ceiling
const client = new x402Client().setSpendControls({ allowedAssets: [{ network: 'cardano:*', asset: 'lovelace', maxAmountPerPayment: '10000000' }] })
const signer = toClientCardanoSigner({ mnemonic, network: NETWORK, provider: { koios: { baseUrl: process.env.KOIOS_URL ?? 'https://preprod.koios.rest/api/v1' } } })
client.register('cardano:*', new ExactCardanoScheme(signer))
const http = new x402HTTPClient(client)
const log = (s: string) => console.log(`[investigator] ${s}`)

log(`case ${caseId} (${classification}), seed ${address}`)
const t0 = Date.now()
const r402 = await fetch(url)
if (r402.status !== 402) throw new Error(`expected 402, got ${r402.status}`)
const offer = http.getPaymentRequiredResponse((n) => r402.headers.get(n)).accepts[0]!
log(`402 Payment Required: ${Number(offer.amount) / 1e6} tADA on ${offer.network} to ${offer.payTo}`)

const decision = decide(BigInt(offer.amount), classification as Classification)
log(`spend policy: ${decision}`)
const base = { label: 'LIVE TESTNET payment, REPLAY trace data', network: NETWORK, provider: 'QUBEE Trace Agent', route: 'GET /api/trace/:address', caseId, classification, seed: address, price: { amount: offer.amount, asset: offer.asset }, payee: offer.payTo, payer: signer.getAddress(), decision, at: new Date().toISOString() }
if (decision !== 'auto') {
  writeFileSync(EVIDENCE, JSON.stringify({ ...base, status: decision === 'human' ? 'HUMAN_APPROVAL_REQUIRED' : 'REFUSED' }, null, 1))
  process.exit(0)
}

log('paying on preprod and retrying (20 to 60 s for confirmation)')
const r200 = await wrapFetchWithPayment(fetch, client)(url)
if (!r200.ok) throw new Error(`paid retry failed: HTTP ${r200.status}. Check the payer on preprod.cardanoscan.io before retrying, or it may pay twice`)
const receipt = http.getPaymentSettleResponse((n) => r200.headers.get(n))
const body = (await r200.json()) as NonNullable<ReturnType<typeof trace>> & { resultHash: string }
log(`200 OK after ${((Date.now() - t0) / 1000).toFixed(1)}s, tx ${receipt?.transaction}`)
log(`${body.totalLinked} linked addresses in ${body.traceCase}, result ${body.resultHash}`)

writeFileSync(
  EVIDENCE,
  JSON.stringify(
    {
      ...base,
      status: 'DELIVERED',
      paymentTx: receipt?.transaction,
      explorer: receipt?.transaction ? `https://preprod.cardanoscan.io/transaction/${receipt.transaction}` : null,
      seconds: Math.round((Date.now() - t0) / 1000),
      result: { traceCase: body.traceCase, chain: body.chain, unit: body.unit, totalLinked: body.totalLinked, resultHash: body.resultHash, source: body.source, linked: body.linked.slice(0, 5) },
    },
    null,
    1,
  ),
)
log('evidence written to apps/observatory/src/data/cardano_x402.json')
