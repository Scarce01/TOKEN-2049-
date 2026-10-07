import { ORGS } from '@quorum/shared'
import { loadDeployment, orgOf } from '@quorum/shared/deployments'
import type { Hex } from 'viem'

function need(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

export const ORG = (process.env.ORG ?? 'a') as 'a' | 'b'
export const SCHEMA = ORG === 'a' ? 'exchange_a' : 'exchange_b'
export const ORG_ID = ORGS[ORG]
export const deployment = loadDeployment()
export const org = orgOf(deployment, ORG)

export const env = {
  port: Number(process.env.PORT ?? (ORG === 'a' ? 8787 : 8788)),
  databaseUrl: need('DATABASE_URL'),
  rpcUrl: need('RPC_URL'),
  wsRpcUrl: process.env.WS_RPC_URL,
  submitterKey: need('SUBMITTER_PRIVATE_KEY') as Hex,
  orgSalt: need('ORG_SALT') as Hex,
  adminToken: need('ADMIN_TOKEN'),
  hotWalletEncKey: need('HOT_WALLET_ENC_KEY') as Hex,
}
