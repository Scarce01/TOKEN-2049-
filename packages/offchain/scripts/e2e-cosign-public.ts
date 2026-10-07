// Cosign on the Chainlink DON, public Base Sepolia: honest withdrawal, org A. No simulate: the DON's log trigger on
// RequestBoard.WithdrawalRequested writes the verdict. Measures submit -> verdict on chain, then pays once due.
// Usage (repo root): bun packages/offchain/scripts/e2e-cosign-public.ts   (E2E_RUNS=3 for several requests)
// Keys: seeder = DEPLOYER_PRIVATE_KEY in contracts/.env (faucet seeder, pays user setup gas),
//       submitter = SUBMITTER_PRIVATE_KEY in apps/exchange-api/.env (submitter A). Neither is printed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Decision,
  DepositVaultAbi,
  FaucetAbi,
  KeyAction,
  KeyBindingTypes,
  KeyRegistryAbi,
  keyDomain,
  MockERC20Abi,
  QuorumReceiverAbi,
  QuorumVaultAbi,
  RequestBoardAbi,
  requestId,
  ThreatRegistryAbi,
  txHash,
  WithdrawalTypes,
  withdrawalDomain,
} from '@quorum/shared'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  parseEventLogs,
  toHex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const root = join(import.meta.dir, '..', '..', '..')
const RPC = process.env.RPC_URL ?? 'https://sepolia.base.org'
const d = JSON.parse(readFileSync(join(root, 'deployments', 'base-sepolia.json'), 'utf8'))
const envKey = (file: string, name: string): Hex => {
  const line = readFileSync(join(root, file), 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`))
  const v = (line?.slice(name.length + 1) ?? '').trim().replace(/^["']|["']$/g, '')
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} missing in ${file}`)
  return (v.startsWith('0x') ? v : `0x${v}`) as Hex
}
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
const wallet = (pk: Hex) =>
  createWalletClient({ chain: baseSepolia, transport: http(RPC), account: privateKeyToAccount(pk) })
const seeder = wallet(envKey('contracts/.env', 'DEPLOYER_PRIVATE_KEY'))
const submitter = wallet(envKey('apps/exchange-api/.env', 'SUBMITTER_PRIVATE_KEY'))
const org = d.orgA
const qUSD = d.qUSD as Address
const RUNS = Number(process.env.E2E_RUNS ?? '1')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function send(w: ReturnType<typeof wallet>, req: Parameters<typeof w.writeContract>[0]) {
  const hash = await w.writeContract(req as never)
  const rc = await pub.waitForTransactionReceipt({ hash })
  if (rc.status !== 'success') throw new Error(`tx reverted ${hash}`)
  return rc
}
const verdictOf = async (th: Hex) =>
  (await pub.readContract({
    address: org.receiver,
    abi: QuorumReceiverAbi,
    functionName: 'verdictOf',
    args: [th],
  })) as {
    decision: number
    notBefore: bigint
    used: boolean
  }
const bal = async (a: Address) =>
  (await pub.readContract({ address: qUSD, abi: MockERC20Abi, functionName: 'balanceOf', args: [a] })) as bigint
const name = (x: number) => Object.entries(Decision).find(([, v]) => v === x)?.[0] ?? String(x)

const activeThreats = (await pub.readContract({
  address: d.threatRegistry,
  abi: ThreatRegistryAbi,
  functionName: 'activeConfirmedCount',
})) as bigint
console.log(`submitter ${submitter.account.address}, active confirmed threats in the network: ${activeThreats}`)

// hot vault needs tokens to pay out
const FUND = 10_000_000_000n
if ((await bal(org.hotVault)) < FUND / 2n) {
  await send(seeder, {
    address: d.faucet,
    abi: FaucetAbi,
    functionName: 'drip',
    args: [qUSD, seeder.account.address, FUND],
  })
  await send(seeder, { address: qUSD, abi: MockERC20Abi, functionName: 'approve', args: [org.hotVault, FUND] })
  await send(seeder, { address: org.hotVault, abi: QuorumVaultAbi, functionName: 'fund', args: [qUSD, FUND] })
  console.log(`funded hot vault A with ${Number(FUND) / 1e6} qUSD`)
}

type Run = {
  submitTx: Hex
  submitBlock: number
  verdictTx?: Hex
  verdictBlock?: number
  blocks?: number
  chainSeconds?: number
  wallSeconds?: number
  decision?: string
  notBefore?: number
  paid?: boolean
  payTx?: Hex
}
const runs: Run[] = []

for (let i = 0; i < RUNS; i++) {
  // 1. user: key on KeyRegistry, 1,000 qUSD deposit (seeder relays, the user has no gas)
  const uid = keccak256(toHex(`public:${Date.now()}:${i}`))
  const user = privateKeyToAccount(generatePrivateKey())
  const dl = (await pub.getBlock()).timestamp + 3600n
  const knonce = (await pub.readContract({
    address: d.keyRegistry,
    abi: KeyRegistryAbi,
    functionName: 'keyNonce',
    args: [uid],
  })) as bigint
  const ksig = await user.signTypedData({
    domain: keyDomain(d.chainId, d.keyRegistry),
    types: KeyBindingTypes,
    primaryType: 'KeyBinding',
    message: { userIdHash: uid, key: user.address, action: KeyAction.REGISTER, nonce: knonce, deadline: dl },
  })
  await send(seeder, {
    address: d.keyRegistry,
    abi: KeyRegistryAbi,
    functionName: 'register',
    args: [uid, user.address, dl, ksig],
  })
  const DEP = 1_000_000_000n
  await send(seeder, {
    address: d.faucet,
    abi: FaucetAbi,
    functionName: 'drip',
    args: [qUSD, seeder.account.address, DEP],
  })
  await send(seeder, { address: qUSD, abi: MockERC20Abi, functionName: 'approve', args: [d.depositVault, DEP] })
  await send(seeder, { address: d.depositVault, abi: DepositVaultAbi, functionName: 'deposit', args: [uid, qUSD, DEP] })

  // 2. user signs the intent, submitter A posts it
  const to = privateKeyToAccount(generatePrivateKey()).address
  const amount = 50_000_000n
  const deadline = (await pub.getBlock()).timestamp + 3600n
  const intent = {
    orgId: org.orgId as Hex,
    userIdHash: uid,
    vault: org.hotVault as Address,
    token: qUSD,
    to,
    amount,
    nonce: 1n,
    deadline,
  }
  const sig = await user.signTypedData({
    domain: withdrawalDomain(d.chainId, d.requestBoard),
    types: WithdrawalTypes,
    primaryType: 'Withdrawal',
    message: intent,
  })
  const rid = requestId(org.orgId, crypto.randomUUID())
  const th = txHash({
    chainId: d.chainId,
    vault: org.hotVault,
    requestId: rid,
    userIdHash: uid,
    token: qUSD,
    to,
    amount,
    nonce: 1n,
    deadline,
  })
  const request = {
    requestId: rid,
    orgId: org.orgId as Hex,
    userIdHash: uid,
    kind: 0,
    vault: org.hotVault as Address,
    token: qUSD,
    to,
    amount,
    nonce: 1n,
    deadline,
    txHash: th,
    safeTx: { to: '0x0000000000000000000000000000000000000000' as Address, value: 0n, data: '0x' as Hex, operation: 0 },
  }
  const t0 = Date.now()
  const rc = await send(submitter, {
    address: d.requestBoard,
    abi: RequestBoardAbi,
    functionName: 'submit',
    args: [request, intent, sig],
  })
  parseEventLogs({ abi: RequestBoardAbi, logs: rc.logs, eventName: 'WithdrawalRequested' })[0]!
  const run: Run = { submitTx: rc.transactionHash, submitBlock: Number(rc.blockNumber) }
  runs.push(run)
  console.log(
    `\n=== run ${i + 1}: 50 qUSD of a 1,000 deposit, org A\n    submitted ${rc.transactionHash} block ${rc.blockNumber}`,
  )

  // 3. wait for the DON's verdict on chain (no simulate, no person)
  let v = await verdictOf(th)
  while (v.decision === 0 && Date.now() - t0 < 5 * 60_000) {
    await sleep(1000)
    v = await verdictOf(th)
  }
  if (v.decision === 0) {
    console.log('    no verdict within 5 min')
    continue
  }
  run.wallSeconds = (Date.now() - t0) / 1000
  run.decision = name(v.decision)
  // find the Receiver's ReportProcessed tx that carried it (200-block slices, public RPC limit)
  const head = await pub.getBlockNumber()
  const logs = await pub.getLogs({
    address: org.receiver,
    fromBlock: rc.blockNumber,
    toBlock: head < rc.blockNumber + 199n ? head : rc.blockNumber + 199n,
  })
  for (const l of logs) {
    const r = await pub.getTransactionReceipt({ hash: l.transactionHash })
    if (r.logs.some((x) => x.data.toLowerCase().includes(th.slice(2).toLowerCase()) || x.topics.includes(th))) {
      run.verdictTx = l.transactionHash
      run.verdictBlock = Number(l.blockNumber)
      break
    }
  }
  if (run.verdictBlock) {
    run.blocks = run.verdictBlock - run.submitBlock
    const [a, b] = await Promise.all([
      pub.getBlock({ blockNumber: rc.blockNumber }),
      pub.getBlock({ blockNumber: BigInt(run.verdictBlock) }),
    ])
    run.chainSeconds = Number(b.timestamp - a.timestamp)
  }
  run.notBefore = Number(v.notBefore)
  console.log(
    `    verdict ${run.decision} in tx ${run.verdictTx ?? '?'} block ${run.verdictBlock ?? '?'}: ${run.blocks ?? '?'} blocks, ${run.chainSeconds ?? '?'} s on chain, ${run.wallSeconds.toFixed(1)} s wall`,
  )

  // 4. pay: refused before notBefore, then the vault pays (submitter sends execute)
  const vaultTx = { requestId: rid, userIdHash: uid, token: qUSD, to, amount, nonce: 1n, deadline }
  const now = Number((await pub.getBlock()).timestamp)
  if (v.notBefore > 0n)
    console.log(
      `    delayed: notBefore in ${Number(v.notBefore) - now} s (network follow, ${activeThreats} active threats)`,
    )
  while (Number((await pub.getBlock()).timestamp) <= Number(v.notBefore)) await sleep(10_000)
  try {
    const pr = await send(submitter, {
      address: org.hotVault,
      abi: QuorumVaultAbi,
      functionName: 'execute',
      args: [vaultTx],
    })
    // read at the receipt's block: the public RPC is load balanced and a plain latest read can lag
    const got = (await pub.readContract({
      address: qUSD,
      abi: MockERC20Abi,
      functionName: 'balanceOf',
      args: [to],
      blockNumber: pr.blockNumber,
    })) as bigint
    run.paid = got === amount
    run.payTx = pr.transactionHash
    console.log(`    vault.execute: PAID ${Number(got) / 1e6} qUSD, tx ${pr.transactionHash}`)
  } catch (e) {
    run.paid = false
    console.log(`    vault.execute: REFUSED (${String(e).match(/Error: [^\n]{0,120}/)?.[0] ?? 'revert'})`)
  }
}

const done = runs.filter((r) => r.chainSeconds !== undefined)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : null
}
const out = {
  source: 'testnet measured (public Base Sepolia, Chainlink DON, cosign workflow 00e143e0)',
  org: 'A',
  activeConfirmedThreats: Number(activeThreats),
  runs,
  medianChainSeconds: median(done.map((r) => r.chainSeconds!)),
  medianBlocks: median(done.map((r) => r.blocks!)),
  allApprovedAndPaid: runs.length > 0 && runs.every((r) => r.decision === 'APPROVE' && r.paid),
}
mkdirSync(join(root, 'reports', 'don'), { recursive: true })
writeFileSync(join(root, 'reports', 'don', 'cosign_public.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(
  `\nmedian submit -> verdict: ${out.medianChainSeconds} s, ${out.medianBlocks} blocks; all approved and paid: ${out.allApprovedAndPaid}`,
)
