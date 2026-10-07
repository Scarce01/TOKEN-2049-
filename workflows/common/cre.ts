// Thin wrappers over the CRE EVM capability. Every read names an explicit block (D30 lint).
import {
  blockNumber,
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  hexToBase64,
  prepareReportRequest,
  protoBigIntToBigint,
  type Runtime,
  TxStatus,
} from '@chainlink/cre-sdk'
import { type Abi, type Address, decodeFunctionResult, encodeFunctionData, type Hex, zeroAddress } from 'viem'

export type Evm = InstanceType<typeof cre.capabilities.EVMClient>

export function evmFor(chainName: string): Evm {
  const net = getNetwork({ chainFamily: 'evm', chainSelectorName: chainName, isTestnet: true })
  if (!net) throw new Error(`network not found: ${chainName}`)
  return new cre.capabilities.EVMClient(net.chainSelector.selector)
}

export type Header = { number: bigint; timestamp: bigint; hash: Hex }

export function headerAt(runtime: Runtime<unknown>, evm: Evm, n: bigint): Header {
  const h = evm.headerByNumber(runtime, { blockNumber: blockNumber(n) }).result().header
  if (!h) throw new Error(`no header for block ${n}`)
  return {
    number: h.blockNumber ? protoBigIntToBigint(h.blockNumber) : n,
    timestamp: h.timestamp,
    hash: bytesToHex(h.hash),
  }
}

/** Latest header. The only read without a fixed block: it defines the cron anchor. */
export function latestHeader(runtime: Runtime<unknown>, evm: Evm): Header {
  // lint-allow: anchor-latest
  const h = evm.headerByNumber(runtime, {}).result().header
  if (!h || !h.blockNumber) throw new Error('no latest header')
  return { number: protoBigIntToBigint(h.blockNumber), timestamp: h.timestamp, hash: bytesToHex(h.hash) }
}

/**
 * Header at a block tag. finalized = -3 (SDK's LAST_FINALIZED_BLOCK_NUMBER); safe = -4 follows the same
 * go-ethereum convention but the SDK does not export it: confirm on Base Sepolia in spike S9.
 */
export function taggedHeader(runtime: Runtime<unknown>, evm: Evm, tag: 'safe' | 'finalized'): Header {
  const blockNumber = { absVal: tag === 'safe' ? 'BA==' : 'Aw==', sign: '-1' } // base64 of 0x04 / 0x03
  // lint-allow: explicit block tag (safe / finalized)
  const h = evm.headerByNumber(runtime, { blockNumber }).result().header
  if (!h || !h.blockNumber) throw new Error(`no ${tag} header`)
  return { number: protoBigIntToBigint(h.blockNumber), timestamp: h.timestamp, hash: bytesToHex(h.hash) }
}

/** Cron anchor: latest - lag (or a fixed block from config for DET runs). */
export function anchorHeader(runtime: Runtime<unknown>, evm: Evm, lag: number, fixedBlock?: number): Header {
  if (fixedBlock !== undefined && fixedBlock > 0) return headerAt(runtime, evm, BigInt(fixedBlock))
  const latest = latestHeader(runtime, evm)
  return headerAt(runtime, evm, latest.number - BigInt(lag))
}

export function callAt<const A extends Abi>(
  runtime: Runtime<unknown>,
  evm: Evm,
  to: Address,
  abi: A,
  functionName: string,
  args: readonly unknown[],
  at: bigint,
): unknown {
  // biome-ignore lint/suspicious/noExplicitAny: viem generic narrowing over a runtime name
  const data = encodeFunctionData({ abi, functionName, args } as any)
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to, data }),
      blockNumber: blockNumber(at),
    })
    .result()
  // biome-ignore lint/suspicious/noExplicitAny: see above
  return decodeFunctionResult({ abi, functionName, data: bytesToHex(reply.data) } as any)
}

export type WriteOutcome = {
  ok: boolean
  txStatus: number
  execStatus: number | undefined
  txHash: Hex
  error?: string
}

/**
 * writeReport + both status fields (CLAUDE.md rule 7). SUCCESS alone only means "mined";
 * receiverContractExecutionStatus tells whether onReport itself reverted.
 */
export function writeReport(
  runtime: Runtime<unknown>,
  evm: Evm,
  receiver: Address,
  reportHex: Hex,
  gasLimit: bigint,
  tag: string,
): WriteOutcome {
  const report = runtime.report(prepareReportRequest(reportHex)).result()
  const r = evm.writeReport(runtime, { receiver, report, gasConfig: { gasLimit: gasLimit.toString() } }).result()
  const execStatus = r.receiverContractExecutionStatus as number | undefined
  const ok = r.txStatus === TxStatus.SUCCESS && (execStatus === undefined || execStatus === 0)
  const txHash = bytesToHex(r.txHash ?? new Uint8Array(32))
  if (!ok) {
    runtime.log(
      `[error] ${tag} writeReport failed tx=${txHash} txStatus=${r.txStatus} exec=${execStatus} ${r.errorMessage ?? ''}`,
    )
  } else {
    runtime.log(`${tag} report ok tx=${txHash}`)
  }
  return { ok, txStatus: r.txStatus as number, execStatus, txHash, error: r.errorMessage }
}

export function secret(runtime: Runtime<unknown>, id: string): string {
  return runtime.getSecret({ id }).result().value
}

export const b64 = hexToBase64
export { bytesToHex, protoBigIntToBigint }
