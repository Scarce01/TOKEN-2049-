// Trap workflow: a decoy is touched -> one confirmed-level report (32_phase2.md 2.4).
// Never reads Supabase or calls exchange-api (D01).
import {
  bytesToBase64,
  consensusIdenticalAggregation,
  cre,
  type EVMLog,
  type NodeRuntime,
  ok,
  type Runtime,
  text,
} from '@chainlink/cre-sdk'
import {
  type Address,
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  hexToBytes,
  pad,
  parseAbi,
  parseAbiParameters,
} from 'viem'
import { z } from 'zod'
import { decoySalt, encodeReport } from '../../packages/shared/src/index'
import { baseConfig } from '../common/config'
import { b64, bytesToHex, evmFor, headerAt, protoBigIntToBigint, secret, writeReport } from '../common/cre'
import { decideTrap, receiptHasLog } from './src/logic/decide'
import {
  canonicalReceipt,
  receiptRequestBody,
  secondSourceAvailable,
  secondSourceVerdict,
  summarizeSecondSource,
  UNAVAILABLE,
} from './src/logic/nownodes'

// i / path: the decoy's Merkle leaf index and proof (phase 5); salt = HMAC(K, "decoy" || i)
const decoy = z.object({
  address: z.string(),
  orgId: z.string(),
  i: z.number().optional(),
  path: z.array(z.string()).optional(),
})
export const configSchema = baseConfig.extend({
  // Plaintext decoy addresses live only here (log filters need them). This file is gitignored.
  decoyWallets: z.array(decoy).max(5),
  decoyAddresses: z.array(decoy).max(10),
  protectedAddrs: z.array(z.string()),
  // Host only. The API key is the NOWNODES_KEY secret, sent as the api-key header.
  // z.string().url() calls new URL(), which the CRE WASM runtime does not provide.
  // '' = no NOWNodes endpoint for this chain: skip the second source (audit H1/H2).
  nownodesRpcUrl: z.union([z.literal(''), z.string().regex(/^https:\/\/\S+$/)]),
})
export type Config = z.infer<typeof configSchema>

const ERC20 = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])
const TRANSFER = encodeEventTopics({ abi: ERC20, eventName: 'Transfer' })[0] as Hex
const topic = (a: string) => b64(pad(a as Hex, { size: 32 }))

// Runs on each node. The key is read in DON mode and passed in: NodeRuntime has no getSecret (SDK 1.23.0).
function readNownodesReceipt(nodeRuntime: NodeRuntime<Config>, txHash: string, rpcUrl: string, apiKey: string): string {
  const body = bytesToBase64(new TextEncoder().encode(receiptRequestBody(txHash)))
  const http = new cre.capabilities.HTTPClient()
  const response = http
    .sendRequest(nodeRuntime, {
      url: rpcUrl,
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
    })
    .result()
  // A failed lookup is "unavailable", not an error: every node then agrees on the same string (audit H2).
  if (!ok(response)) return UNAVAILABLE
  try {
    return canonicalReceipt(text(response))
  } catch {
    return UNAVAILABLE
  }
}

function onTransfer(runtime: Runtime<Config>, log: EVMLog): string {
  const c = runtime.config
  const evm = evmFor(c.chainName)
  const txHash = bytesToHex(log.txHash)
  const at = log.blockNumber ? protoBigIntToBigint(log.blockNumber) : 0n
  const topics = log.topics.map((t) => bytesToHex(t))
  const thisLog = { address: bytesToHex(log.address), topics, data: bytesToHex(log.data), index: log.index }

  // 1. Re-read the receipt: the log must really exist (D48).
  const receipt = evm.getTransactionReceipt(runtime, { hash: b64(txHash) }).result().receipt
  const receiptLogs = (receipt?.logs ?? []).map((l) => ({
    address: bytesToHex(l.address),
    topics: l.topics.map((t) => bytesToHex(t)),
    data: bytesToHex(l.data),
    index: l.index,
  }))
  if (!receipt || receipt.status !== 1n || !receiptHasLog(receiptLogs, thisLog)) {
    runtime.log('[warn] trigger log not found in receipt; no action')
    return 'no-op: receipt mismatch'
  }

  // 2. Block time for every on-chain time (rule 5).
  const header = headerAt(runtime, evm, at)
  const ev = decodeEventLog({ abi: ERC20, data: thisLog.data, topics: topics as [Hex, ...Hex[]] })
  const tok = c.tokens.find((t) => t.address.toLowerCase() === thisLog.address.toLowerCase())
  if (!tok) return 'no-op: unknown token'

  // Second source (audit H1/H2): a contradicting NOWNodes receipt stops the trap (D48); a missing, late or failed
  // one does not, because a third party being slow or down must not be able to suppress tightening (rule 6).
  if (secondSourceAvailable(c.nownodesRpcUrl)) {
    const apiKey = secret(runtime, 'NOWNODES_KEY')
    if (apiKey.length === 0) throw new Error('NOWNODES_KEY is empty')
    let second = UNAVAILABLE
    try {
      second = runtime
        .runInNodeMode(readNownodesReceipt, consensusIdenticalAggregation<string>())(txHash, c.nownodesRpcUrl, apiKey)
        .result()
    } catch {
      // nodes saw different NOWNodes answers: no consensus on the second source, treat as unavailable
    }
    runtime.log(`nownodes ${summarizeSecondSource(second)}`)
    const v = secondSourceVerdict(second, thisLog)
    if (v === 'contradiction') {
      runtime.log('[warn] nownodes receipt contradicts the trigger log; no action (D48)')
      return 'no-op: nownodes mismatch'
    }
    if (v === 'unavailable') runtime.log('[warn] nownodes unavailable; acting on the CRE receipt')
  } else {
    runtime.log('nownodes not served on this chain; acting on the CRE receipt')
  }

  // Merkle proof for a committed decoy wallet (only wallets have one; Kind B has suspect 0 anyway)
  let proof: Hex | undefined
  const dw = c.decoyWallets.find((x) => x.address.toLowerCase() === ev.args.from.toLowerCase())
  if (dw && dw.i !== undefined && dw.path) {
    const k = hexToBytes(secret(runtime, 'QUORUM_K') as Hex)
    proof = encodeAbiParameters(parseAbiParameters('bytes32, bytes32, bytes32[]'), [
      pad(dw.address as Hex, { size: 32 }),
      decoySalt(k, dw.i),
      dw.path as Hex[],
    ])
  }

  const d = decideTrap({
    chainId: BigInt(c.chainId),
    token: thisLog.address as Address,
    from: ev.args.from,
    to: ev.args.to,
    amount: ev.args.value,
    txHash,
    logIndex: BigInt(log.index),
    blockTime: header.timestamp,
    tokenDecimals: tok.decimals,
    decoyWallets: c.decoyWallets.map((x) => ({ address: x.address as Address, orgId: x.orgId as Hex })),
    decoyAddresses: c.decoyAddresses.map((x) => ({ address: x.address as Address, orgId: x.orgId as Hex })),
    vaults: c.orgs.map((o) => ({ orgId: o.orgId as Hex, hot: o.hotVault as Address, warm: o.warmVault as Address })),
    protectedAddrs: c.protectedAddrs as Address[],
    tokens: c.tokens.map((t) => t.address as Address),
    freezeDuration: BigInt(c.freezeDuration),
    alertTtl: BigInt(c.alertTtlConfirmed),
    coldDelay: BigInt(c.coldDelayTight),
    threatTtl: BigInt(c.threatTtl),
    proof,
  })
  if (!d) {
    runtime.log('transfer does not match a trap rule; no action')
    return 'no-op'
  }
  const org = c.orgs.find((o) => o.orgId.toLowerCase() === d.orgId.toLowerCase())!
  // Logs carry the case id only, never decoy addresses (rule 2).
  runtime.log(`trap ${d.kind} tripped case=${d.caseId.slice(0, 10)}`)
  const report = encodeReport({
    chainId: BigInt(c.chainId),
    orgId: d.orgId,
    caseId: d.caseId,
    issuedAt: header.timestamp,
    actions: d.actions,
  })
  const w = writeReport(
    runtime,
    evm,
    org.receiver as Address,
    report,
    BigInt(c.reportGasLimit),
    `trap case=${d.caseId.slice(0, 10)}`,
  )
  return w.ok ? `tightened ${d.caseId}` : `failed ${d.caseId}`
}

export function initWorkflow(c: Config) {
  const evm = evmFor(c.chainName)
  const tokenAddrs = c.tokens.map((t) => b64(t.address))
  const handlers = []
  if (c.decoyWallets.length > 0) {
    // A: Transfer(from = decoy wallet)
    handlers.push(
      cre.handler(
        evm.logTrigger({
          addresses: tokenAddrs,
          topics: [{ values: [b64(TRANSFER)] }, { values: c.decoyWallets.map((d) => topic(d.address)) }],
          confidence: 'CONFIDENCE_LEVEL_LATEST',
        }),
        onTransfer,
      ),
    )
  }
  if (c.decoyAddresses.length > 0) {
    // B: Transfer(from = our hot/warm vault, to = decoy recipient address)
    const vaults = c.orgs.flatMap((o) => [o.hotVault, o.warmVault])
    handlers.push(
      cre.handler(
        evm.logTrigger({
          addresses: tokenAddrs,
          topics: [
            { values: [b64(TRANSFER)] },
            { values: vaults.map(topic) },
            { values: c.decoyAddresses.map((d) => topic(d.address)) },
          ],
          confidence: 'CONFIDENCE_LEVEL_LATEST',
        }),
        onTransfer,
      ),
    )
  }
  return handlers
}
