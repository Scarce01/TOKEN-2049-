// QUBEE Trace Agent: a paid forensic trace API on x402 (Cardano preprod).
// GET /api/trace/:address -> 402 with payment terms; a paid retry is verified and settled by the facilitator and
// gets the QUBEE trace downstream of that address. Holds no keys: it only receives at SELLER_ADDRESS.
// Unknown address -> 404, and x402 does not settle a 4xx, so nobody pays for an empty answer.
import { createHash } from 'node:crypto'
import { ExactCardanoScheme } from '@x402/cardano/exact/server'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import express from 'express'
import { trace } from './trace'

const payTo = process.env.SELLER_ADDRESS
const facilitatorUrl = process.env.FACILITATOR_URL
if (!payTo?.startsWith('addr_test1') || !facilitatorUrl) throw new Error('set SELLER_ADDRESS (addr_test1...) and FACILITATOR_URL in .env (run pnpm wallet)')

const NETWORK = 'cardano:preprod' as const
const PRICE_LOVELACE = process.env.PRICE_LOVELACE ?? '1000000' // 1 tADA: lovelace prices must clear the ~1 ADA min-UTxO

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }))
resourceServer.register(NETWORK, new ExactCardanoScheme())

const app = express()
app.use(
  paymentMiddleware(
    {
      'GET /api/trace/:address': {
        accepts: [{ scheme: 'exact', network: NETWORK, price: { amount: PRICE_LOVELACE, asset: 'lovelace' }, payTo }],
        description: 'QUBEE forensic trace: addresses that received tainted funds downstream of an address, with evidence tx',
        mimeType: 'application/json',
      },
    },
    resourceServer,
  ),
)

app.get('/api/trace/:address', (req, res) => {
  const out = trace(req.params.address)
  if (!out) return res.status(404).json({ error: 'address not in any traced case' })
  const resultHash = `0x${createHash('sha256').update(JSON.stringify(out.linked)).digest('hex')}`
  res.json({ ...out, resultHash })
})
app.get('/health', (_req, res) => res.json({ ok: true }))

const port = Number(process.env.SELLER_PORT ?? 4021)
app.listen(port, () => console.log(`Trace Agent on :${port}, ${Number(PRICE_LOVELACE) / 1e6} tADA per trace on ${NETWORK}, payee ${payTo}`))
