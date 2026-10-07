import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Address, Hex } from 'viem'

/** Off-chain only (uses fs). Workflows receive addresses through their config instead. */
export type OrgDeployment = {
  orgId: Hex
  receiver: Address
  /** OfficerDesk for this org (officer signatures target it) */
  desk: Address
  hotVault: Address
  warmVault: Address
  coldVault: Address
}

export type Deployment = {
  chainId: number
  startBlock: number
  resetBlock: number
  mode: 'PROD' | 'SIM'
  forwarder: Address
  officerSet: Address
  configTimelock: Address
  faucet: Address
  qUSD: Address
  qETH: Address
  priceFeed: Address
  depositVault: Address
  keyRegistry: Address
  requestBoard: Address
  threatRegistry: Address
  quorumLens: Address
  decoyCommit: Address // phase 5; written by Deploy.s.sol into every deployment file
  patrolState: Address // phase 6
  orgA: OrgDeployment
  orgB: OrgDeployment
}

export const repoRoot = join(import.meta.dir, '..', '..', '..')

export function loadDeployment(name = process.env.DEPLOY_NAME ?? 'base-sepolia'): Deployment {
  return JSON.parse(readFileSync(join(repoRoot, 'deployments', `${name}.json`), 'utf8')) as Deployment
}

export function orgOf(d: Deployment, org: 'a' | 'b'): OrgDeployment {
  return org === 'a' ? d.orgA : d.orgB
}
