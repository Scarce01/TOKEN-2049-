// End-to-end prevention layer on a local fork: key -> deposit -> signed request -> CRE CLI cosign verdict -> vault.
// Usage (repo root): anvil --fork-url https://sepolia.base.org running, contracts deployed as DEPLOY_NAME=base-sepolia-fork,
//   bun packages/offchain/scripts/e2e-prevention.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CancelWithdrawalTypes,
  cancelDomain,
  Decision,
  DepositVaultAbi,
  FaucetAbi,
  intentDigest,
  KeyAction,
  KeyBindingTypes,
  KeyRegistryAbi,
  keyDomain,
  MockERC20Abi,
  MockV3AggregatorAbi,
  OfficerDeskAbi,
  OfficerKind,
  QuorumReceiverAbi,
  QuorumVaultAbi,
  RequestBoardAbi,
  requestId,
  softwarePasskey,
  ThreatRegistryAbi,
  txHash,
  WithdrawalTypes,
  withdrawalDomain,
} from '@quorum/shared'
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  type Hex,
  hexToBytes,
  http,
  keccak256,
  parseEventLogs,
  toHex,
} from 'viem'
import { generatePrivateKey, type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'

const root = join(import.meta.dir, '..', '..', '..')
const RPC = 'http://127.0.0.1:8545'
const d = JSON.parse(readFileSync(join(root, 'deployments', 'base-sepolia-fork.json'), 'utf8'))
const keys = JSON.parse(readFileSync(join(root, 'secrets', 'base-sepolia-keys.local.json'), 'utf8')).keys
const chain = defineChain({
  id: 84532,
  name: 'base-sepolia-fork',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})
const pub = createPublicClient({ chain, transport: http(RPC) })
const wallet = (pk: Hex) => createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(pk) })
const seeder = wallet(keys.SEEDER.privateKey)
// E2E_ORG=b runs the same cases against org B, e.g. while org A sits in a confirmed alert from a trap test on the
// shared fork (alerts are per Receiver). Default org A.
const ORG_KEY = process.env.E2E_ORG === 'b' ? 'b' : 'a'
const submitter = wallet((ORG_KEY === 'b' ? keys.SUBMITTER_B : keys.SUBMITTER_A).privateKey)
const org = ORG_KEY === 'b' ? d.orgB : d.orgA
const qUSD = d.qUSD as Address
// Network follow (Cosign gate 4, docs/47): while any confirmed threat is active anywhere in the network, every member
// runs at level >= 1, so even an honest withdrawal waits the L1 delay. Case A checks whichever state the fork is in.
const networkCalm =
  (await pub.readContract({
    address: d.threatRegistry,
    abi: ThreatRegistryAbi,
    functionName: 'activeConfirmedCount',
  })) === 0n

async function send(w: ReturnType<typeof wallet>, req: Parameters<typeof w.writeContract>[0]) {
  const hash = await w.writeContract(req as never)
  const rc = await pub.waitForTransactionReceipt({ hash })
  if (rc.status !== 'success') throw new Error(`tx reverted ${hash}`)
  return rc
}

async function setupUser(label: string, depositAmt: bigint) {
  const uid = keccak256(toHex(`e2e:${label}:${Date.now()}`))
  const userPk = generatePrivateKey()
  const user = privateKeyToAccount(userPk)
  const deadline = BigInt((await pub.getBlock()).timestamp + 3600n)
  const nonce = (await pub.readContract({
    address: d.keyRegistry,
    abi: KeyRegistryAbi,
    functionName: 'keyNonce',
    args: [uid],
  })) as bigint
  const sig = await user.signTypedData({
    domain: keyDomain(d.chainId, d.keyRegistry),
    types: KeyBindingTypes,
    primaryType: 'KeyBinding',
    message: { userIdHash: uid, key: user.address, action: KeyAction.REGISTER, nonce, deadline },
  })
  await send(seeder, {
    address: d.keyRegistry,
    abi: KeyRegistryAbi,
    functionName: 'register',
    args: [uid, user.address, deadline, sig],
  })
  await send(seeder, {
    address: d.faucet,
    abi: FaucetAbi,
    functionName: 'drip',
    args: [qUSD, seeder.account.address, depositAmt],
  })
  await send(seeder, { address: qUSD, abi: MockERC20Abi, functionName: 'approve', args: [d.depositVault, depositAmt] })
  await send(seeder, {
    address: d.depositVault,
    abi: DepositVaultAbi,
    functionName: 'deposit',
    args: [uid, qUSD, depositAmt],
  })
  return { uid, user }
}

/** docs/47 3.4: a user whose key is a passkey; registration relayed by the seeder (the user has no gas). */
async function setupPasskeyUser(label: string, depositAmt: bigint) {
  const uid = keccak256(toHex(`e2e:${label}:${Date.now()}`))
  const pk = softwarePasskey(hexToBytes(generatePrivateKey()))
  const deadline = (await pub.getBlock()).timestamp + 3600n
  const nonce = (await pub.readContract({
    address: d.keyRegistry,
    abi: KeyRegistryAbi,
    functionName: 'keyNonce',
    args: [uid],
  })) as bigint
  const digest = (await pub.readContract({
    address: d.keyRegistry,
    abi: KeyRegistryAbi,
    functionName: 'keyBindingDigest',
    args: [uid, pk.keyId, KeyAction.REGISTER, nonce, deadline],
  })) as Hex
  await send(seeder, {
    address: d.keyRegistry,
    abi: KeyRegistryAbi,
    functionName: 'register',
    args: [uid, pk.keyId, deadline, pk.sign(digest)],
  })
  await send(seeder, {
    address: d.faucet,
    abi: FaucetAbi,
    functionName: 'drip',
    args: [qUSD, seeder.account.address, depositAmt],
  })
  await send(seeder, { address: qUSD, abi: MockERC20Abi, functionName: 'approve', args: [d.depositVault, depositAmt] })
  await send(seeder, {
    address: d.depositVault,
    abi: DepositVaultAbi,
    functionName: 'deposit',
    args: [uid, qUSD, depositAmt],
  })
  return { uid, pk }
}

async function submitWithdrawal(
  uid: Hex,
  signer: ReturnType<typeof privateKeyToAccount>,
  to: Address,
  amount: bigint,
  n: bigint,
  signDigest?: (digest: Hex) => Hex,
) {
  const deadline = (await pub.getBlock()).timestamp + 3600n
  const intent = {
    orgId: org.orgId as Hex,
    userIdHash: uid,
    vault: org.hotVault as Address,
    token: qUSD,
    to,
    amount,
    nonce: n,
    deadline,
  }
  const sig = signDigest
    ? signDigest(intentDigest(d.chainId, d.requestBoard, intent))
    : await signer.signTypedData({
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
    nonce: n,
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
    nonce: n,
    deadline,
    txHash: th,
    safeTx: { to: '0x0000000000000000000000000000000000000000' as Address, value: 0n, data: '0x' as Hex, operation: 0 },
  }
  const rc = await send(submitter, {
    address: d.requestBoard,
    abi: RequestBoardAbi,
    functionName: 'submit',
    args: [request, intent, sig],
  })
  const ev = parseEventLogs({ abi: RequestBoardAbi, logs: rc.logs, eventName: 'WithdrawalRequested' })[0]!
  return {
    rid,
    th,
    tx: rc.transactionHash,
    logIndex: ev.logIndex,
    vaultTx: { requestId: rid, userIdHash: uid, token: qUSD, to, amount, nonce: n, deadline },
  }
}

function cosign(tx: Hex, logIndex: number) {
  const p = Bun.spawnSync(
    [
      'cre',
      'workflow',
      'simulate',
      'cosign',
      '-T',
      'fork-settings',
      '--non-interactive',
      '--trigger-index',
      '0',
      '--evm-tx-hash',
      tx,
      '--evm-event-index',
      String(logIndex),
      '--broadcast',
    ],
    { cwd: join(root, 'workflows'), stdout: 'pipe', stderr: 'pipe' },
  )
  const out = p.stdout.toString() + p.stderr.toString()
  return out
    .split('\n')
    .filter((l) => /USER LOG|Result|rror/.test(l))
    .slice(-6)
    .join('\n')
}

const verdict = async (th: Hex) =>
  (await pub.readContract({
    address: org.receiver,
    abi: QuorumReceiverAbi,
    functionName: 'verdictOf',
    args: [th],
  })) as {
    decision: number
    used: boolean
  }
const name = (x: number) => Object.entries(Decision).find(([, v]) => v === x)?.[0] ?? String(x)
const bal = async (a: Address) =>
  (await pub.readContract({ address: qUSD, abi: MockERC20Abi, functionName: 'balanceOf', args: [a] })) as bigint

// demo price feed: refresh so earlier time warps on this fork do not make gate 6 see a stale price
const [, px] = (await pub.readContract({
  address: d.priceFeed,
  abi: MockV3AggregatorAbi,
  functionName: 'latestRoundData',
})) as [bigint, bigint]
await send(seeder, { address: d.priceFeed, abi: MockV3AggregatorAbi, functionName: 'updateAnswer', args: [px] })

// hot vault needs tokens to pay out (fund() keeps asset conservation exact)
const FUND = 100_000_000_000n
await send(seeder, {
  address: d.faucet,
  abi: FaucetAbi,
  functionName: 'drip',
  args: [qUSD, seeder.account.address, FUND],
})
await send(seeder, { address: qUSD, abi: MockERC20Abi, functionName: 'approve', args: [org.hotVault, FUND] })
await send(seeder, { address: org.hotVault, abi: QuorumVaultAbi, functionName: 'fund', args: [qUSD, FUND] })

// OfficerAction signatures (EIP-712 digest from the contract), signers in ascending address order
async function officerAction(kind: number, subject: Hex, value: bigint, nonce: bigint, who: string[]) {
  const deadline = (await pub.getBlock()).timestamp + 3600n
  const digest = (await pub.readContract({
    address: org.desk,
    abi: OfficerDeskAbi,
    functionName: 'officerDigest',
    args: [kind, subject, value, nonce, deadline],
  })) as Hex
  const signers = who.map((n) => privateKeyToAccount(keys[n].privateKey))
  signers.sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1))
  const sigs = await Promise.all(signers.map((s) => s.sign({ hash: digest })))
  const fn = kind === OfficerKind.HOLD_VERDICT ? 'holdVerdict' : 'cancelVerdict'
  const args =
    kind === OfficerKind.HOLD_VERDICT ? [subject, value, nonce, deadline, sigs] : [subject, nonce, deadline, sigs]
  await send(seeder, { address: org.desk, abi: OfficerDeskAbi, functionName: fn, args } as never)
}
const heldUntil = async (txh: Hex) =>
  (await pub.readContract({
    address: org.receiver,
    abi: QuorumReceiverAbi,
    functionName: 'heldUntil',
    args: [txh],
  })) as bigint

const cases: {
  name: string
  expect: string
  run: () => Promise<{ th: Hex; tx: Hex; logIndex: number; vaultTx: unknown; to: Address; user?: PrivateKeyAccount }>
  /** seconds to fast-forward the fork before a second execute attempt (delayed APPROVE, docs/47) */
  warp?: number
  want: { decision: number; paidNow: boolean; delayed?: boolean; shadow?: boolean; paidAfter?: boolean }
  /** officer actions between the verdict and the first execute attempt */
  afterVerdict?: (txh: Hex, user?: PrivateKeyAccount) => Promise<void>
}[] = [
  {
    name: 'A honest: 50 qUSD of a 1,000 deposit, valid signature',
    expect: networkCalm
      ? 'APPROVE, vault pays'
      : 'APPROVE delayed L1 (network follow: a confirmed threat is active), paid after the delay, no person involved',
    ...(networkCalm ? {} : { warp: 601 }),
    want: networkCalm
      ? { decision: Decision.APPROVE, paidNow: true }
      : { decision: Decision.APPROVE, paidNow: false, delayed: true, paidAfter: true },
    run: async () => {
      const { uid, user } = await setupUser('honest', 1_000_000_000n)
      const to = privateKeyToAccount(generatePrivateKey()).address
      return { ...(await submitWithdrawal(uid, user, to, 50_000_000n, 1n)), to }
    },
  },
  {
    name: 'B forged: backend signs with a key that is not the user key',
    expect: 'REJECT (31), vault refuses',
    want: { decision: Decision.REJECT, paidNow: false },
    run: async () => {
      const { uid } = await setupUser('forged', 1_000_000_000n)
      const attacker = privateKeyToAccount(generatePrivateKey())
      const to = attacker.address
      return { ...(await submitWithdrawal(uid, attacker, to, 900_000_000n, 1n)), to }
    },
  },
  {
    name: 'C over deposit: 2,000 qUSD with a 1,000 deposit, valid signature',
    expect: 'PENDING (51), vault refuses',
    want: { decision: Decision.PENDING, paidNow: false },
    run: async () => {
      const { uid, user } = await setupUser('over', 1_000_000_000n)
      const to = privateKeyToAccount(generatePrivateKey()).address
      return { ...(await submitWithdrawal(uid, user, to, 2_000_000_000n, 1n)), to }
    },
  },
  {
    name: 'E large to a new address: 6,000 qUSD (L_pub 5,000, R2 in shadow mode)',
    expect: 'delayed by the hidden cap; R2 only logged as shadow=largeNew',
    want: { decision: Decision.APPROVE, paidNow: false, delayed: true, shadow: true },
    run: async () => {
      const { uid, user } = await setupUser('largenew', 10_000_000_000n)
      const to = privateKeyToAccount(generatePrivateKey()).address
      return { ...(await submitWithdrawal(uid, user, to, 6_000_000_000n, 1n)), to }
    },
  },
  {
    name: 'H passkey user: a P-256 WebAuthn key registers, signs 50 qUSD and gets paid (docs/47 3.4)',
    expect: 'signerOf = key id; APPROVE delayed by the passkey new-address floor (3.6), paid after it',
    want: { decision: Decision.APPROVE, paidNow: false, delayed: true, paidAfter: true },
    warp: 601,
    run: async () => {
      const { uid, pk } = await setupPasskeyUser('passkey', 1_000_000_000n)
      const to = privateKeyToAccount(generatePrivateKey()).address
      const r = await submitWithdrawal(uid, privateKeyToAccount(generatePrivateKey()), to, 50_000_000n, 1n, (digest) =>
        pk.sign(digest),
      )
      const signer = (await pub.readContract({
        address: d.requestBoard,
        abi: RequestBoardAbi,
        functionName: 'signerOf',
        args: [r.rid],
      })) as Address
      console.log(
        `    signerOf=${signer} keyId=${pk.keyId} ${signer.toLowerCase() === pk.keyId.toLowerCase() ? 'match' : 'MISMATCH'}`,
      )
      return { ...r, to }
    },
  },
  {
    name: 'G user cancels their own delayed withdrawal with their key (docs/47 3.3)',
    expect: 'APPROVE delayed, then UserCancelled on chain; vault refuses; keeper would drop it',
    want: { decision: Decision.APPROVE, paidNow: false, delayed: true },
    afterVerdict: async (txh, user) => {
      const deadline = (await pub.getBlock()).timestamp + 600n
      const sig = await user!.signTypedData({
        domain: cancelDomain(d.chainId, org.receiver),
        types: CancelWithdrawalTypes,
        primaryType: 'CancelWithdrawal',
        message: { txHash: txh, deadline },
      })
      // relayed by the seeder: the user needs no gas
      await send(seeder, {
        address: org.receiver,
        abi: QuorumReceiverAbi,
        functionName: 'userCancelVerdict',
        args: [txh, deadline, sig],
      })
      const v = (await pub.readContract({
        address: org.receiver,
        abi: QuorumReceiverAbi,
        functionName: 'verdictOf',
        args: [txh],
      })) as { released: boolean }
      console.log(`    user cancel relayed: released=${v.released}`)
    },
    run: async () => {
      const { uid, user } = await setupUser('usercancel', 10_000_000_000n)
      const to = privateKeyToAccount(generatePrivateKey()).address
      return { ...(await submitWithdrawal(uid, user, to, 3_000_000_000n, 1n)), to, user }
    },
  },
  {
    name: 'F officer stops one approved withdrawal: one officer HOLDs, two officers cancel (docs/47 phase 2)',
    expect: 'APPROVE, then HOLD and CANCEL on chain; vault refuses',
    want: { decision: Decision.APPROVE, paidNow: false },
    afterVerdict: async (txh) => {
      const until = (await pub.getBlock()).timestamp + 600n
      await officerAction(OfficerKind.HOLD_VERDICT, txh, until, 1n, ['OFFICER_1'])
      console.log(`    officer HOLD until +600 s: heldUntil=${await heldUntil(txh)}`)
      await officerAction(OfficerKind.CANCEL_VERDICT, txh, 0n, 2n, ['OFFICER_1', 'OFFICER_2'])
      console.log('    two officers CANCEL: verdict dropped')
    },
    run: async () => {
      const { uid, user } = await setupUser('held', 1_000_000_000n)
      const to = privateKeyToAccount(generatePrivateKey()).address
      return { ...(await submitWithdrawal(uid, user, to, 40_000_000n, 1n)), to }
    },
  },
  {
    name: 'D over the hidden cap: 3,000 qUSD (cap range 500 to 2,000) of a 10,000 deposit',
    expect: 'APPROVE delayed D2 (1 h): refused now, paid after the delay, no person involved',
    warp: 3601,
    want: { decision: Decision.APPROVE, paidNow: false, delayed: true, paidAfter: true },
    run: async () => {
      const { uid, user } = await setupUser('delay', 10_000_000_000n)
      const to = privateKeyToAccount(generatePrivateKey()).address
      return { ...(await submitWithdrawal(uid, user, to, 3_000_000_000n, 1n)), to }
    },
  },
  // Tracing (docs/36 6.4): only when services/redteam/demo/trace-fork.ts hands over an address that CRE verify-edge
  // listed as a derived THREAT. Not part of the default run.
  ...(process.env.TRACED_TO
    ? [
        {
          name: 'T traced recipient: 50 qUSD to an address CRE verify-edge listed (derived THREAT)',
          expect: 'PENDING (42, shared list), vault refuses',
          want: { decision: Decision.PENDING, paidNow: false },
          run: async () => {
            const { uid, user } = await setupUser('traced', 1_000_000_000n)
            const to = process.env.TRACED_TO as Address
            return { ...(await submitWithdrawal(uid, user, to, 50_000_000n, 1n)), to }
          },
        },
      ]
    : []),
]

const results: { case: string; ok: boolean }[] = []
// E2E_CASES=F,D runs only those cases (by their leading letter)
const only = process.env.E2E_CASES?.split(',').map((s) => s.trim().toUpperCase())
for (const c of cases) {
  if (only && !only.includes(c.name[0]!.toUpperCase())) continue
  console.log(`\n=== ${c.name}\n    expected: ${c.expect}`)
  const r = await c.run()
  console.log(`    submitted tx ${r.tx} log ${r.logIndex}`)
  const log = cosign(r.tx, r.logIndex)
  console.log(log.replace(/^/gm, '    | '))
  const v = await verdict(r.th)
  console.log(`    on-chain verdict: ${name(v.decision)}`)
  const nb = (
    (await pub.readContract({
      address: org.receiver,
      abi: QuorumReceiverAbi,
      functionName: 'verdictOf',
      args: [r.th],
    })) as {
      notBefore: bigint
    }
  ).notBefore
  if (nb > 0n) console.log(`    notBefore: ${nb - (await pub.getBlock()).timestamp} s from now`)
  const attempt = async (label: string) => {
    const before = await bal(r.to)
    try {
      await send(submitter, { address: org.hotVault, abi: QuorumVaultAbi, functionName: 'execute', args: [r.vaultTx] })
      console.log(`    vault.execute ${label}: PAID ${Number((await bal(r.to)) - before) / 1e6} qUSD`)
      return (await bal(r.to)) > before
    } catch (e) {
      console.log(
        `    vault.execute ${label}: REFUSED (${String(e).match(/reverted|Error: [^\n]{0,80}/)?.[0] ?? 'revert'})`,
      )
      return false
    }
  }
  if (c.afterVerdict) {
    try {
      await c.afterVerdict(r.th, r.user)
    } catch (e) {
      // decode the custom error against both ABIs so a flake is never an anonymous selector again
      const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined
      const sel = rev instanceof ContractFunctionRevertedError ? (rev.signature ?? rev.data?.errorName) : undefined
      let name = sel
      if (sel && /^0x[0-9a-f]{8}$/i.test(sel))
        for (const abi of [QuorumReceiverAbi, OfficerDeskAbi])
          try {
            name = decodeErrorResult({ abi, data: sel as Hex }).errorName
            break
          } catch {}
      console.log(`    officer action FAILED: ${name ?? String(e).slice(0, 200)}`)
      results.push({ case: c.name, ok: false })
      continue
    }
  }
  const paidNow = await attempt('now')
  let paidAfter: boolean | undefined
  if (c.warp) {
    await pub.request({ method: 'evm_increaseTime' as never, params: [c.warp] as never })
    // mine past ANCHOR_LAG (5 blocks) so Patrol's anchor is after the warp; otherwise the Receiver
    // correctly skips the refill as a stale report (ActionStale)
    for (let i = 0; i < 6; i++) await pub.request({ method: 'evm_mine' as never, params: [] as never })
    // what happens in production every epoch: Patrol refills the quota (reads FINALIZED, CLAUDE.md rule 6)
    const refill = Bun.spawnSync(
      [
        'cre',
        'workflow',
        'simulate',
        'patrol',
        '-T',
        'fork-settings',
        '--non-interactive',
        '--trigger-index',
        '3',
        '--broadcast',
      ],
      { cwd: join(root, 'workflows'), stdout: 'pipe', stderr: 'pipe' },
    )
    console.log(
      (refill.stdout.toString() + refill.stderr.toString())
        .split('\n')
        .filter((l) => /USER LOG/.test(l))
        .slice(-2)
        .join('\n')
        .replace(/^/gm, '    | '),
    )
    // nobody from the exchange sends it: the independent keeper pays once it is due (docs/47 3.1)
    const before = await bal(r.to)
    const k = Bun.spawnSync(['bun', 'services/keeper/src/index.ts', '--once'], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        DEPLOY_NAME: 'base-sepolia-fork',
        RPC_URL: RPC,
        KEEPER_PRIVATE_KEY: keys.SEEDER.privateKey,
        KEEPER_FROM_BLOCK: String(d.startBlock),
      },
    })
    const klog = (k.stdout.toString() + k.stderr.toString()).trim()
    console.log(klog.replace(/^/gm, '    keeper | '))
    paidAfter = (await bal(r.to)) > before
    console.log(
      `    after ${c.warp} s, keeper: ${paidAfter ? `PAID ${Number((await bal(r.to)) - before) / 1e6} qUSD` : 'not paid'}`,
    )
  }
  const w = c.want
  const ok =
    v.decision === w.decision &&
    paidNow === w.paidNow &&
    (w.delayed === undefined || nb > 0n === w.delayed) &&
    (w.shadow === undefined || log.includes('shadow=largeNew') === w.shadow) &&
    (w.paidAfter === undefined || paidAfter === w.paidAfter)
  console.log(`    ${ok ? 'PASS' : 'FAIL'}`)
  results.push({ case: c.name, ok })
}

const allOk = results.every((x) => x.ok)
const passed = results.filter((x) => x.ok).length
const scene = {
  ok: allOk,
  summary: `${passed}/${results.length} cases, org ${ORG_KEY.toUpperCase()} (local anvil fork of Base Sepolia, CRE CLI simulate --broadcast)`,
  source: 'testnet fork (local)',
  results,
}
// Only a full default run is evidence for the scene report; a filtered or traced run must not overwrite it.
if (!only && !process.env.TRACED_TO) {
  mkdirSync(join(root, 'reports', 'scenes'), { recursive: true })
  writeFileSync(join(root, 'reports', 'scenes', 'fork_prevention_e2e.json'), `${JSON.stringify(scene, null, 2)}\n`)
}
console.log(`\n${allOk ? 'ALL PASS' : 'FAILURES'}: ${passed}/${results.length}`)
if (!allOk) process.exit(1)
