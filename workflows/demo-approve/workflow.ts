// Demo-only: write one APPROVE so a later hot-vault execute can reach AlertConfirmed.
// This is not Cosign. It does not score, gate, or tighten. Trap is unchanged.
// issuedAt comes from the anchor block. No clock, no float, no network fetch.
import { cre, type Runtime } from '@chainlink/cre-sdk'
import type { Address, Hex } from 'viem'
import { z } from 'zod'
import { act, Decision, encodeReport } from '../../packages/shared/src/index'
import { anchorHeader, evmFor, writeReport } from '../common/cre'

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

export const configSchema = z.object({
  chainName: z.string(),
  chainId: z.number(),
  schedule: z.string(),
  anchorLag: z.number(),
  reportGasLimit: z.string(),
  receiver: addr,
  orgId: hex32,
  requestId: hex32,
  txHash: hex32,
  userIdHash: hex32,
  token: addr,
  amount: z.string(),
  expiresIn: z.number(),
})
export type Config = z.infer<typeof configSchema>

function onApprove(runtime: Runtime<Config>): string {
  const c = runtime.config
  const evm = evmFor(c.chainName)
  const header = anchorHeader(runtime, evm, c.anchorLag)
  const issuedAt = header.timestamp
  const expiresAt = issuedAt + BigInt(c.expiresIn)
  const report = encodeReport({
    chainId: BigInt(c.chainId),
    orgId: c.orgId as Hex,
    caseId: c.requestId as Hex,
    issuedAt,
    actions: [
      act.verdict({
        requestId: c.requestId as Hex,
        txHash: c.txHash as Hex,
        userIdHash: c.userIdHash as Hex,
        token: c.token as Address,
        amount: BigInt(c.amount),
        decision: Decision.APPROVE,
        publicReason: 0,
        notBefore: 0n,
        expiresAt,
        sealedReason: '0x',
      }),
    ],
  })
  const wrote = writeReport(runtime, evm, c.receiver as Address, report, BigInt(c.reportGasLimit), 'demo approve')
  return wrote.ok ? `approved ${c.txHash}` : `failed ${c.txHash}`
}

export function initWorkflow(c: Config) {
  const cron = new cre.capabilities.CronCapability()
  return [cre.handler(cron.trigger({ schedule: c.schedule }), onApprove)]
}
