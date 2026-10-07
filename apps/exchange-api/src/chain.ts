// Chain access for the untrusted backend: submit, execute, read verdicts. No judging here.
import { DepositVaultAbi, KeyRegistryAbi, QuorumReceiverAbi, QuorumVaultAbi, RequestBoardAbi } from '@quorum/shared'
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  webSocket,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, foundry, sepolia } from 'viem/chains'
import { deployment, env } from './env'

const chain = deployment.chainId === 31337 ? foundry : deployment.chainId === 11155111 ? sepolia : baseSepolia
export const account = privateKeyToAccount(env.submitterKey)
export const pub = createPublicClient({ chain, transport: http(env.rpcUrl) })
export const wsPub = env.wsRpcUrl ? createPublicClient({ chain, transport: webSocket(env.wsRpcUrl) }) : pub
export const wallet = createWalletClient({ chain, account, transport: http(env.rpcUrl) })

// Single submit key, serialized sends (one nonce manager).
let queue: Promise<unknown> = Promise.resolve()
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => undefined)
  return next
}

/** Returns the custom error name of a revert, if any. */
export function revertName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? undefined
  }
  return undefined
}

export async function writeAndWait(args: {
  address: Address
  // biome-ignore lint/suspicious/noExplicitAny: abi union
  abi: any
  functionName: string
  args: readonly unknown[]
}): Promise<Hex> {
  return serial(async () => {
    const { request } = await pub.simulateContract({ account, ...args })
    const hash = await wallet.writeContract(request)
    const rc = await pub.waitForTransactionReceipt({ hash })
    if (rc.status !== 'success') throw new Error(`tx reverted ${hash}`)
    return hash
  })
}

export const abis = { RequestBoardAbi, QuorumReceiverAbi, QuorumVaultAbi, KeyRegistryAbi, DepositVaultAbi }
