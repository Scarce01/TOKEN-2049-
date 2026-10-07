// One causal demo: rank, probe, CRE on that same transfer, then a 500 qUSD drain reverts.
// The ranker never sees defender config. That file is read only after the probe receipts exist.
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DepositVaultAbi,
  FaucetAbi,
  KeyRegistryAbi,
  QuorumReceiverAbi,
  QuorumVaultAbi,
  RequestBoardAbi,
  ThreatRegistryAbi,
  txHash as vaultTxHash,
} from '@quorum/shared'
import { loadDeployment } from '@quorum/shared/deployments'
import {
  type Account,
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  http,
  keccak256,
  toBytes,
} from 'viem'
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { probeTransfer } from '../src/attack'
import { rankWallets } from '../src/rank'
import { fetchHotWallets } from '../src/scanner'

const root = join(import.meta.dir, '..', '..', '..')
const ANVIL = 'test test test test test test test test test test test junk'
const DRAIN = 500_000_000n
const ONE = 1_000_000n
// Expected order and decoy rank are defender data (secrets/visible-wallets.layout.local.json, written by
// datasets seed-visible); they are read only after the probes, like the trap config (rule 2, audit 2026-10-07 H3).
type Layout = { synthetic: { amount: string }[]; decoyAmount: string; decoyRank: number }
function layoutFile(): Layout {
  return JSON.parse(readFileSync(join(root, 'secrets/visible-wallets.layout.local.json'), 'utf8')) as Layout
}
// solc 0.8.24, optimizer 200, cancun. Source: services/redteam/demo/DemoSubmit.sol
const DEMO_SUBMIT_BYTECODE =
  '0x608060405234801561000f575f80fd5b506101848061001d5f395ff3fe608060405234801561000f575f80fd5b5060043610610029575f3560e01c80636fadcf721461002d575b5f80fd5b61004061003b3660046100b6565b610042565b005b5f80846001600160a01b0316848460405161005e92919061013f565b5f604051808303815f865af19150503d805f8114610097576040519150601f19603f3d011682016040523d82523d5f602084013e61009c565b606091505b509150915081156100ae575050505050565b805160208201fd5b5f805f604084860312156100c8575f80fd5b83356001600160a01b03811681146100de575f80fd5b9250602084013567ffffffffffffffff808211156100fa575f80fd5b818601915086601f83011261010d575f80fd5b81358181111561011b575f80fd5b87602082850101111561012c575f80fd5b6020830194508093505050509250925092565b818382375f910190815291905056fea2646970667358221220e0e61bb21b5d01f44304950a60d909fad12b4ebf26de0ea3e38abd4352f68a3464736f6c63430008180033' as Hex
const DEMO_SUBMIT_ABI = [
  {
    type: 'function',
    name: 'forward',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'board', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

function loadEnv(path: string) {
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq)
    let value = trimmed.slice(eq + 1)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing env ${name}`)
  return value
}

function qusd(base: bigint): string {
  const whole = base / ONE
  const text = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = base % ONE
  if (frac === 0n) return text
  return `${text}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`
}

function revertName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined
  const hit = error.walk((item) => item instanceof ContractFunctionRevertedError)
  return hit instanceof ContractFunctionRevertedError ? hit.data?.errorName : undefined
}

function section(code: string, title: string, lines: string[] = []) {
  console.log(`\n[${code}] ${title}`)
  for (const line of lines) console.log(line)
}

function creRuntimeEnv(): NodeJS.ProcessEnv {
  const realHome = process.env.HOME ?? ''
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(realHome, '.cre/bin')}:${process.env.PATH ?? ''}`,
  }
  const probe = join(realHome, '.cre/cre.yaml.tmp')
  try {
    writeFileSync(probe, '')
    unlinkSync(probe)
  } catch {
    const home = '/tmp/demo-home'
    mkdirSync(join(home, '.cre'), { recursive: true })
    copyFileSync(join(realHome, '.cre/cre.yaml'), join(home, '.cre/cre.yaml'))
    env.HOME = home
  }
  return env
}

async function runCre(args: string[]): Promise<string> {
  const env = creRuntimeEnv()
  const creBin = process.env.CRE_BIN ?? join(process.env.HOME ?? '', '.cre/bin/cre')
  const proc = Bun.spawn([creBin, 'workflow', 'simulate', ...args, '--env', '.env', '--evm-receipt-timeout', '3m'], {
    cwd: join(root, 'workflows'),
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })
  const timer = setTimeout(() => proc.kill(), 20 * 60 * 1000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  const out = `${stdout}\n${stderr}`
  if (code !== 0) {
    const tail = out.trim().split('\n').slice(-30).join('\n')
    throw new Error(`cre exit ${code}\n${tail}`)
  }
  return out
}

loadEnv(join(root, 'contracts/.env'))
loadEnv(join(root, 'apps/exchange-api/.env'))
loadEnv(join(root, 'services/redteam/.env'))

const rpc = process.env.RPC_URL ?? need('ETHEREUM_SEPOLIA_RPC')
const deployment = loadDeployment('ethereum-sepolia')
const attacker = need('ATTACKER_RECEIVER') as Address
const baseUrl = process.env.EXCHANGE_API_URL ?? 'http://127.0.0.1:8787'
const adminToken = need('ADMIN_TOKEN')
const deployer = privateKeyToAccount(need('DEPLOYER_PRIVATE_KEY') as Hex)
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) })
const pay = (account: Account) => createWalletClient({ account, chain: sepolia, transport: http(rpc) })

type Snap = { alert: number; quota: bigint; warmOpen: boolean; suspect: boolean }

async function snap(): Promise<Snap> {
  const block = await pub.getBlock()
  const [alert, quota, frozenUntil, suspect] = await Promise.all([
    pub.readContract({ address: deployment.orgA.receiver, abi: QuorumReceiverAbi, functionName: 'alert' }),
    pub.readContract({
      address: deployment.orgA.hotVault,
      abi: QuorumVaultAbi,
      functionName: 'quota',
      args: [deployment.qUSD],
    }),
    pub.readContract({
      address: deployment.orgA.receiver,
      abi: QuorumReceiverAbi,
      functionName: 'frozenUntil',
      args: [deployment.orgA.warmVault],
    }),
    pub.readContract({
      address: deployment.threatRegistry,
      abi: ThreatRegistryAbi,
      functionName: 'isSuspect',
      args: [attacker],
    }),
  ])
  return {
    alert: Number(alert),
    quota: quota as bigint,
    warmOpen: (frozenUntil as bigint) <= block.timestamp,
    suspect: Boolean(suspect),
  }
}

type VaultTx = {
  requestId: Hex
  userIdHash: Hex
  token: Address
  to: Address
  amount: bigint
  nonce: bigint
  deadline: bigint
}

async function send(
  account: Account,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
) {
  const wallet = pay(account)
  const hash = await wallet.writeContract({
    address,
    abi: abi as never,
    functionName,
    args,
    account,
    chain: sepolia,
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted ${hash}`)
  return hash
}

async function feeCaps() {
  const block = await pub.getBlock()
  const base = block.baseFeePerGas ?? 1_000_000_000n
  const maxPriorityFeePerGas = 2_000_000_000n
  return { maxFeePerGas: base * 2n + maxPriorityFeePerGas, maxPriorityFeePerGas }
}

/** The registered submitter is a public Anvil key. Bots take any ETH sent to it, so the
 * deployer pays gas and EIP-7702 makes RequestBoard see that key as msg.sender. */
async function demoSubmitRelay(): Promise<Address> {
  const path = join(root, '.tmp/demo-submit.json')
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8')) as { address?: string }
    if (saved.address) {
      const code = await pub.getBytecode({ address: saved.address as Address })
      if (code && code !== '0x') return saved.address as Address
    }
  } catch {
    // first deploy
  }
  const fees = await feeCaps()
  const hash = await pay(deployer).deployContract({
    abi: DEMO_SUBMIT_ABI,
    bytecode: DEMO_SUBMIT_BYTECODE,
    account: deployer,
    chain: sepolia,
    ...fees,
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('demo submit relay did not deploy')
  mkdirSync(join(root, '.tmp'), { recursive: true })
  writeFileSync(path, JSON.stringify({ address: receipt.contractAddress }))
  return receipt.contractAddress
}

async function postAsSubmitter(submitter: ReturnType<typeof mnemonicToAccount>, data: Hex): Promise<Hex> {
  const relay = await demoSubmitRelay()
  const call = encodeFunctionData({
    abi: DEMO_SUBMIT_ABI,
    functionName: 'forward',
    args: [deployment.requestBoard, data],
  })
  const code = await pub.getBytecode({ address: submitter.address })
  const delegated = code?.toLowerCase() === `0xef0100${relay.slice(2).toLowerCase()}`
  const fees = await feeCaps()
  if (!delegated && !submitter.signAuthorization) throw new Error('submitter cannot sign a delegation')
  const authorizationList = delegated
    ? undefined
    : [
        await submitter.signAuthorization!({
          contractAddress: relay,
          chainId: sepolia.id,
          nonce: Number(await pub.getTransactionCount({ address: submitter.address })),
        }),
      ]
  const hash = await pay(deployer).sendTransaction({
    account: deployer,
    chain: sepolia,
    to: submitter.address,
    data: call,
    gas: 500_000n,
    ...fees,
    ...(authorizationList ? { authorizationList } : {}),
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`submit reverted ${hash}`)
  return hash
}

async function placeApproval(): Promise<{ vaultTx: VaultTx; reportTx: string }> {
  const submitter = mnemonicToAccount(ANVIL, { addressIndex: 4 })
  const user = mnemonicToAccount(ANVIL, { addressIndex: 8 })
  if (submitter.address.toLowerCase() !== need('SUBMITTER_A').toLowerCase()) {
    throw new Error('public anvil submitter does not match SUBMITTER_A')
  }
  const org = deployment.orgA
  const userIdHash = keccak256(toBytes('demo-e2e-user-v1'))
  const requestId = keccak256(toBytes(`demo-e2e-withdraw:${org.hotVault.toLowerCase()}`))
  const savedPath = join(root, '.tmp/demo-e2e-approval.json')
  mkdirSync(join(root, '.tmp'), { recursive: true })

  const key = (await pub.readContract({
    address: deployment.keyRegistry,
    abi: KeyRegistryAbi,
    functionName: 'keyOf',
    args: [userIdHash],
  })) as Address
  if (key === '0x0000000000000000000000000000000000000000') {
    const block = await pub.getBlock()
    const deadline = block.timestamp + 6n * 60n * 60n
    const nonce = (await pub.readContract({
      address: deployment.keyRegistry,
      abi: KeyRegistryAbi,
      functionName: 'keyNonce',
      args: [userIdHash],
    })) as bigint
    const digest = (await pub.readContract({
      address: deployment.keyRegistry,
      abi: KeyRegistryAbi,
      functionName: 'keyBindingDigest',
      args: [userIdHash, user.address, 1, nonce, deadline],
    })) as Hex
    const sig = await user.sign!({ hash: digest })
    await send(deployer, deployment.keyRegistry, KeyRegistryAbi, 'register', [userIdHash, user.address, deadline, sig])
  }

  const deposited = (await pub.readContract({
    address: deployment.depositVault,
    abi: DepositVaultAbi,
    functionName: 'depositedOf',
    args: [userIdHash, deployment.qUSD],
  })) as bigint
  if (deposited < DRAIN) {
    const short = DRAIN - deposited
    const have = (await pub.readContract({
      address: deployment.qUSD,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [deployer.address],
    })) as bigint
    if (have < short) {
      await send(deployer, deployment.faucet, FaucetAbi, 'drip', [deployment.qUSD, deployer.address, short - have])
    }
    await send(deployer, deployment.qUSD, erc20Abi, 'approve', [deployment.depositVault, short])
    await send(deployer, deployment.depositVault, DepositVaultAbi, 'deposit', [userIdHash, deployment.qUSD, short])
  }

  const boardHash = (await pub.readContract({
    address: deployment.requestBoard,
    abi: RequestBoardAbi,
    functionName: 'txHashOf',
    args: [requestId],
  })) as Hex
  let vaultTx: VaultTx
  if (boardHash === `0x${'00'.repeat(32)}`) {
    const block = await pub.getBlock()
    const deadline = block.timestamp + 6n * 60n * 60n
    vaultTx = {
      requestId,
      userIdHash,
      token: deployment.qUSD,
      to: attacker,
      amount: DRAIN,
      nonce: 1n,
      deadline,
    }
    const hash = vaultTxHash({ ...vaultTx, chainId: deployment.chainId, vault: org.hotVault })
    const intent = {
      orgId: org.orgId,
      userIdHash,
      vault: org.hotVault,
      token: deployment.qUSD,
      to: attacker,
      amount: DRAIN,
      nonce: 1n,
      deadline,
    }
    const digest = (await pub.readContract({
      address: deployment.requestBoard,
      abi: RequestBoardAbi,
      functionName: 'intentDigest',
      args: [intent],
    })) as Hex
    const sig = await user.sign!({ hash: digest })
    const req = {
      ...intent,
      requestId,
      txHash: hash,
      kind: 0,
      safeTx: {
        to: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: '0x' as Hex,
        operation: 0,
      },
    }
    const submitData = encodeFunctionData({
      abi: RequestBoardAbi,
      functionName: 'submit',
      args: [req, intent, sig],
    })
    await postAsSubmitter(submitter, submitData)
    const posted = (await pub.readContract({
      address: deployment.requestBoard,
      abi: RequestBoardAbi,
      functionName: 'txHashOf',
      args: [requestId],
    })) as Hex
    if (posted.toLowerCase() !== hash.toLowerCase()) throw new Error('board did not record this withdrawal')
    writeFileSync(
      savedPath,
      JSON.stringify({
        ...vaultTx,
        deadline: vaultTx.deadline.toString(),
        amount: vaultTx.amount.toString(),
        nonce: '1',
      }),
    )
  } else {
    const saved = JSON.parse(readFileSync(savedPath, 'utf8')) as {
      requestId: Hex
      userIdHash: Hex
      token: Address
      to: Address
      amount: string
      nonce: string
      deadline: string
    }
    vaultTx = {
      requestId: saved.requestId,
      userIdHash: saved.userIdHash,
      token: saved.token,
      to: saved.to,
      amount: BigInt(saved.amount),
      nonce: BigInt(saved.nonce),
      deadline: BigInt(saved.deadline),
    }
    const hash = vaultTxHash({ ...vaultTx, chainId: deployment.chainId, vault: org.hotVault })
    if (hash.toLowerCase() !== boardHash.toLowerCase()) throw new Error('saved withdrawal does not match the board')
  }

  const hash = vaultTxHash({ ...vaultTx, chainId: deployment.chainId, vault: org.hotVault })
  const verdict = (await pub.readContract({
    address: org.receiver,
    abi: QuorumReceiverAbi,
    functionName: 'verdictOf',
    args: [hash],
  })) as { decision: number }
  let reportTx = 'already-approved'
  if (Number(verdict.decision) !== 1) {
    const config = {
      chainName: 'ethereum-testnet-sepolia',
      chainId: deployment.chainId,
      schedule: '0 0 * * * *',
      anchorLag: 5,
      reportGasLimit: '1500000',
      receiver: org.receiver,
      orgId: org.orgId,
      requestId,
      txHash: hash,
      userIdHash,
      token: deployment.qUSD,
      amount: DRAIN.toString(),
      expiresIn: 3600,
    }
    writeFileSync(join(root, 'workflows/demo-approve/config.staging.json'), JSON.stringify(config, null, 2))
    const log = await runCre([
      './demo-approve',
      '--target',
      'staging-settings',
      '--non-interactive',
      '--trigger-index',
      '0',
      '--broadcast',
    ])
    const found = log.match(/report ok tx=(0x[0-9a-fA-F]{64})/)
    const reportTxHash = found?.[1]
    if (!reportTxHash) throw new Error('approve workflow did not report a tx')
    reportTx = reportTxHash
    const again = (await pub.readContract({
      address: org.receiver,
      abi: QuorumReceiverAbi,
      functionName: 'verdictOf',
      args: [hash],
    })) as { decision: number }
    if (Number(again.decision) !== 1) throw new Error(`approve report landed but decision is ${again.decision}`)
  }
  return { vaultTx, reportTx }
}

function stagingConfig(): { orgs?: { receiver?: string }[]; decoyWallets?: { address: string }[] } {
  return JSON.parse(readFileSync(join(root, 'workflows/trap/config.staging.json'), 'utf8')) as {
    orgs?: { receiver?: string }[]
    decoyWallets?: { address: string }[]
  }
}

async function apiServesList(url: string): Promise<boolean> {
  try {
    const health = await fetch(new URL('/health', url))
    if (!health.ok) return false
    const res = await fetch(new URL('/admin/hot-wallets', url), {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    if (!res.ok) return false
    const body: unknown = await res.json()
    if (!Array.isArray(body) || body.length === 0 || !body[0] || typeof body[0] !== 'object') return false
    return !Object.keys(body[0]).includes('privateKey')
  } catch {
    return false
  }
}

/** Use the configured API when it already hides keys. Otherwise start a current one beside it. */
async function ensureApi(configured: string): Promise<string> {
  if (await apiServesList(configured)) return configured
  const url = 'http://127.0.0.1:8797'
  Bun.spawn(['bun', 'src/index.ts'], {
    cwd: join(root, 'apps/exchange-api'),
    env: { ...process.env, PORT: '8797', NO_WORKERS: '1', DEPLOY_NAME: 'ethereum-sepolia' },
    stdout: 'ignore',
    stderr: 'pipe',
  })
  for (let i = 0; i < 40; i++) {
    if (await apiServesList(url)) return url
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('exchange-api did not serve the keyless hot-wallet list')
}

async function main() {
  if (deployment.chainId !== 11155111 || deployment.mode !== 'SIM')
    throw new Error('deployment is not ethereum sepolia SIM')
  const stagedReceiver = stagingConfig().orgs?.[0]?.receiver?.toLowerCase()
  if (stagedReceiver !== deployment.orgA.receiver.toLowerCase()) {
    throw new Error('trap staging config does not match this deployment')
  }
  const before = await snap()
  if (before.alert !== 0 || before.quota < 5_000n * ONE || !before.warmOpen || before.suspect) {
    throw new Error(
      `org A is not a fresh demo (alert ${before.alert}, quota ${before.quota}, warm ${before.warmOpen ? 'open' : 'frozen'}, suspect ${before.suspect})`,
    )
  }
  section('00', 'Fresh system', [
    `Alert: ${before.alert}`,
    `Hot quota: ${qusd(before.quota)} qUSD`,
    'Warm: open',
    'ThreatRegistry: receiver not suspect',
  ])

  const api = await ensureApi(baseUrl)
  section('01', 'Attacker compromises backend', ['admin token accepted', 'signing path stays on exchange-api'])

  const wallets = await fetchHotWallets(api, adminToken)
  section('02', `Scanning ${wallets.length} active wallets`)
  const ranked = rankWallets(wallets)
  const top = ranked.slice(0, 5)
  if (top.length < 5) throw new Error('fewer than 5 eligible wallets')
  section(
    '03',
    'Top candidates found',
    top.map((row) => `#${row.rank} ${row.label}`),
  )

  const probes: { rank: number; label: string; address: string; tx: Hex }[] = []
  for (let i = 0; i < 3; i++) {
    const row = top[i]
    if (!row) throw new Error(`missing candidate ${i + 1}`)
    const tx = (await probeTransfer(api, adminToken, row.address, attacker)) as Hex
    probes.push({ rank: row.rank, label: row.label, address: row.address, tx })
    section(String(4 + i).padStart(2, '0'), `Probe #${row.rank}`, [row.label, `1 qUSD -> ${attacker}`])
  }

  // Defender side from here on: the probes exist, now compare against the secrets layout and the trap config.
  const layout = layoutFile()
  const want = [layout.decoyAmount, ...layout.synthetic.map((r) => r.amount)]
    .map(BigInt)
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
    .slice(0, 5)
  for (let i = 0; i < want.length; i++) {
    if (BigInt(top[i]?.balance ?? -1) !== want[i]) throw new Error(`rank ${i + 1} balance does not match the layout`)
  }
  const hidden = new Set((stagingConfig().decoyWallets ?? []).map((row) => row.address.toLowerCase()))
  const hit = probes.find((probe) => hidden.has(probe.address.toLowerCase()))
  if (!hit || hit.rank !== layout.decoyRank) throw new Error('no probe touched the decoy at its layout rank')
  const receipt = await pub.getTransactionReceipt({ hash: hit.tx })
  if (receipt.status !== 'success') throw new Error('probe receipt failed')
  let eventIndex = -1
  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i]
    if (!log || log.address.toLowerCase() !== deployment.qUSD.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics })
      if (ev.eventName !== 'Transfer') continue
      if (
        ev.args.from.toLowerCase() === hit.address.toLowerCase() &&
        ev.args.to.toLowerCase() === attacker.toLowerCase()
      ) {
        eventIndex = i
        break
      }
    } catch {
      // not this token's Transfer
    }
  }
  if (eventIndex < 0) throw new Error('probe receipt has no matching transfer log')
  section('07', 'TRAP TRIPPED', ['one probe touched a decoy', 'case id: see the CRE log'])

  const creLog = await runCre([
    './trap',
    '--target',
    'staging-settings',
    '--non-interactive',
    '--trigger-index',
    '0',
    '--evm-tx-hash',
    hit.tx,
    '--evm-event-index',
    String(eventIndex),
    '--broadcast',
  ])
  const reportTx = creLog.match(/report ok tx=(0x[0-9a-fA-F]{64})/)?.[1]
  if (!/nownodes status=1/.test(creLog)) throw new Error('NOWNodes did not confirm the log')
  if (!/trap A tripped/.test(creLog)) throw new Error('trap A did not trip')
  if (!reportTx) throw new Error('CRE report tx missing')
  section('08', 'CRE workflow', [
    'Ethereum Sepolia receipt ok',
    'NOWNodes second source ok',
    'Trap A ok',
    'CRE report ok',
    `tx: ${reportTx}`,
  ])

  const after = await snap()
  if (after.alert !== 4 || after.quota !== 0n || after.warmOpen || !after.suspect) {
    throw new Error(
      `tighten missed (alert ${after.alert}, quota ${after.quota}, warm ${after.warmOpen ? 'open' : 'frozen'}, suspect ${after.suspect})`,
    )
  }
  section('09', 'Quorum state', [
    'Alert:',
    `${before.alert} -> ${after.alert}`,
    'Hot quota:',
    `${qusd(before.quota)} -> ${qusd(after.quota)}`,
    'Warm:',
    'open -> frozen',
    'ThreatRegistry:',
    'receiver -> suspect',
  ])

  const approval = await placeApproval()
  const data = encodeFunctionData({
    abi: QuorumVaultAbi,
    functionName: 'execute',
    args: [approval.vaultTx],
  })
  let reason = 'unknown'
  try {
    await pub.simulateContract({
      account: deployer,
      address: deployment.orgA.hotVault,
      abi: QuorumVaultAbi,
      functionName: 'execute',
      args: [approval.vaultTx],
    })
  } catch (error) {
    reason = revertName(error) ?? 'unknown'
  }
  const drain = await pay(deployer).sendTransaction({
    account: deployer,
    chain: sepolia,
    to: deployment.orgA.hotVault,
    data,
    gas: 400_000n,
  })
  const drainReceipt = await pub.waitForTransactionReceipt({ hash: drain })
  section('10', 'Attacker launches real drain', ['500 qUSD', `approval ${approval.reportTx}`, `execute ${drain}`])
  if (drainReceipt.status !== 'reverted' || reason !== 'AlertConfirmed') {
    throw new Error(`drain status ${drainReceipt.status} reason ${reason}`)
  }
  section('11', '', ['REVERT', reason])
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\ndemo failed: ${message}`)
  process.exit(1)
})
