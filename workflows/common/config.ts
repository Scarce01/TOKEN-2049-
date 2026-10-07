import { z } from 'zod'

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

export const orgConfig = z.object({
  orgId: hex32,
  receiver: addr,
  hotVault: addr,
  warmVault: addr,
  coldVault: addr,
})

export const baseConfig = z.object({
  chainName: z.string(),
  chainId: z.number(),
  orgs: z.array(orgConfig).min(1),
  tokens: z.array(z.object({ address: addr, decimals: z.number() })),
  reportGasLimit: z.string(),
  freezeDuration: z.number(),
  alertTtlConfirmed: z.number(),
  coldDelayTight: z.number(),
  threatTtl: z.number(),
})

export type OrgConfig = z.infer<typeof orgConfig>
export type BaseConfig = z.infer<typeof baseConfig>

export const lower = (a: string) => a.toLowerCase()
