'use client'
// User App (33_phase3.md 3.2): the user signs exactly what leaves; the backend only forwards.
import {
  CancelWithdrawalTypes,
  cancelDomain,
  DepositVaultAbi,
  FaucetAbi,
  intentDigest,
  KeyAction,
  KeyBindingTypes,
  KeyRegistryAbi,
  keyDomain,
  MockERC20Abi,
  QuorumReceiverAbi,
  WithdrawalTypes,
  withdrawalDomain,
} from '@quorum/shared'
import { useEffect, useState } from 'react'
import {
  type Account,
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  type Hex,
  http,
  parseUnits,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, foundry } from 'viem/chains'
import { createPasskey, loadPasskey, type Passkey, passkeySign } from './passkey'

type Dep = {
  chainId: number
  keyRegistry: Address
  depositVault: Address
  requestBoard: Address
  faucet: Address
  qUSD: Address
  qETH: Address
  receivers: Record<string, Address>
}
type Verdict = { decision: number; used: boolean; released: boolean; notBefore: bigint }
type User = {
  user_id: string
  user_id_hash: Hex
  nextNonce: string
  vault: Address
  orgId: Hex
  chainId: number
  requestBoard: Address
}
declare global {
  interface Window {
    __DEPLOYMENT__: Dep
    ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
  }
}

const API = process.env.NEXT_PUBLIC_EXCHANGE_API ?? 'http://localhost:8787'
const ZERO = '0x0000000000000000000000000000000000000000'

export default function App() {
  const [d, setD] = useState<Dep>()
  const [tab, setTab] = useState<'setup' | 'deposit' | 'withdraw' | 'status'>('setup')
  const [userId, setUserId] = useState('')
  const [user, setUser] = useState<User>()
  const [devKey, setDevKey] = useState('')
  const [signer, setSigner] = useState<{ account: Account | Address; wallet: WalletClient }>()
  const [registered, setRegistered] = useState<Address>()
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState({ token: 'qUSD', to: '', amount: '' })
  const [pending, setPending] = useState<{ id: string; txHash?: Hex } | null>(null)
  const [status, setStatus] = useState<{ status: string; case_display: string | null }>()
  const [verdict, setVerdict] = useState<Verdict>()
  const [passkey, setPasskey] = useState<Passkey>()
  useEffect(() => setPasskey(loadPasskey()), [])

  /** docs/47 3.4: Face ID / fingerprint as the signing key. The exchange relays the registration (no gas needed). */
  async function registerPasskey() {
    if (!d || !user || !pub) return
    setMsg('')
    try {
      const pk = await createPasskey(user.user_id)
      const nonce = (await pub.readContract({
        address: d.keyRegistry,
        abi: KeyRegistryAbi,
        functionName: 'keyNonce',
        args: [user.user_id_hash],
      })) as bigint
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const digest = (await pub.readContract({
        address: d.keyRegistry,
        abi: KeyRegistryAbi,
        functionName: 'keyBindingDigest',
        args: [user.user_id_hash, pk.keyId, KeyAction.REGISTER, nonce, deadline],
      })) as Hex
      const sig = await passkeySign(pk, digest)
      const r = await fetch(`${API}/keys/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userIdHash: user.user_id_hash, key: pk.keyId, deadline: deadline.toString(), sig }),
      })
      if (!r.ok) return setMsg(await r.text())
      setPasskey(pk)
      await loadUser()
    } catch (e) {
      setMsg(String((e as Error).message))
    }
  }

  useEffect(() => setD(window.__DEPLOYMENT__), [])
  const chain = d?.chainId === 31337 ? foundry : baseSepolia
  const pub = d ? createPublicClient({ chain, transport: http(process.env.NEXT_PUBLIC_RPC_URL) }) : undefined
  const myAddr = signer ? (typeof signer.account === 'string' ? signer.account : signer.account.address) : undefined
  const token = form.token === 'qUSD' ? d?.qUSD : d?.qETH
  const decimals = form.token === 'qUSD' ? 6 : 18

  async function loadUser() {
    setMsg('')
    const r = await fetch(`${API}/users/${userId}`)
    if (!r.ok) return setMsg('Unknown user')
    const u = (await r.json()) as User
    setUser(u)
    if (pub && d)
      setRegistered(
        (await pub.readContract({
          address: d.keyRegistry,
          abi: KeyRegistryAbi,
          functionName: 'keyOf',
          args: [u.user_id_hash],
        })) as Address,
      )
  }

  async function connect() {
    if (devKey) {
      const account = privateKeyToAccount(devKey as Hex)
      setSigner({
        account,
        wallet: createWalletClient({ account, chain, transport: http(process.env.NEXT_PUBLIC_RPC_URL) }),
      })
      return
    }
    if (!window.ethereum) return setMsg('No injected wallet; paste a dev key instead')
    const wallet = createWalletClient({ chain, transport: custom(window.ethereum) })
    const [a] = await wallet.requestAddresses()
    setSigner({ account: a!, wallet })
  }

  async function register() {
    if (!d || !user || !signer || !pub) return
    const nonce = (await pub.readContract({
      address: d.keyRegistry,
      abi: KeyRegistryAbi,
      functionName: 'keyNonce',
      args: [user.user_id_hash],
    })) as bigint
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const sig = await signer.wallet.signTypedData({
      account: signer.account,
      domain: keyDomain(d.chainId, d.keyRegistry),
      types: KeyBindingTypes,
      primaryType: 'KeyBinding',
      message: { userIdHash: user.user_id_hash, key: myAddr!, action: KeyAction.REGISTER, nonce, deadline },
    })
    const h = await signer.wallet.writeContract({
      account: signer.account,
      chain,
      address: d.keyRegistry,
      abi: KeyRegistryAbi,
      functionName: 'register',
      args: [user.user_id_hash, myAddr!, deadline, sig],
    })
    await pub.waitForTransactionReceipt({ hash: h })
    await loadUser()
    setMsg('Key registered (or queued, if this account already has deposits).')
  }

  async function deposit() {
    if (!d || !user || !signer || !pub || !token) return
    // Refuse to deposit into an account whose registered key is not ours (hijacked first registration).
    if (registered?.toLowerCase() !== myAddr?.toLowerCase())
      return setMsg('The registered key for this account is not yours. Deposit refused.')
    const amt = parseUnits(form.amount || '0', decimals)
    const w = signer.wallet
    const a = signer.account
    await pub.waitForTransactionReceipt({
      hash: await w.writeContract({
        account: a,
        chain,
        address: d.faucet,
        abi: FaucetAbi,
        functionName: 'drip',
        args: [token, myAddr!, amt],
      }),
    })
    await pub.waitForTransactionReceipt({
      hash: await w.writeContract({
        account: a,
        chain,
        address: token,
        abi: MockERC20Abi,
        functionName: 'approve',
        args: [d.depositVault, amt],
      }),
    })
    const h = await w.writeContract({
      account: a,
      chain,
      address: d.depositVault,
      abi: DepositVaultAbi,
      functionName: 'deposit',
      args: [user.user_id_hash, token, amt],
    })
    await pub.waitForTransactionReceipt({ hash: h })
    setMsg(`Deposited ${form.amount} ${form.token}`)
  }

  const intent =
    user && token && form.to && form.amount
      ? {
          orgId: user.orgId,
          userIdHash: user.user_id_hash,
          vault: user.vault,
          token,
          to: form.to as Address,
          amount: parseUnits(form.amount, decimals),
          nonce: BigInt(user.nextNonce),
          deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        }
      : undefined

  async function withdraw() {
    if (!intent || !d || !user || (!signer && !passkey)) return
    // the passkey signs the same EIP-712 digest a wallet would; the contract accepts either format
    const sig = passkey
      ? await passkeySign(passkey, intentDigest(d.chainId, d.requestBoard, intent))
      : await signer!.wallet.signTypedData({
          account: signer!.account,
          domain: withdrawalDomain(d.chainId, d.requestBoard),
          types: WithdrawalTypes,
          primaryType: 'Withdrawal',
          message: intent,
        })
    const body = {
      userId: user.user_id,
      token: intent.token,
      to: intent.to,
      amount: intent.amount.toString(),
      nonce: intent.nonce.toString(),
      deadline: intent.deadline.toString(),
      signature: sig,
      intent: Object.fromEntries(Object.entries(intent).map(([k, v]) => [k, String(v)])),
    }
    const r = await fetch(`${API}/withdrawals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return setMsg(await r.text())
    setPending(await r.json())
    setTab('status')
  }

  useEffect(() => {
    if (!pending) return
    const receiver = user && d ? d.receivers[user.orgId.toLowerCase()] : undefined
    const client = d
      ? createPublicClient({
          chain: d.chainId === 31337 ? foundry : baseSepolia,
          transport: http(process.env.NEXT_PUBLIC_RPC_URL),
        })
      : undefined
    const t = setInterval(async () => {
      const r = await fetch(`${API}/withdrawals/${pending.id}`)
      if (r.ok) setStatus(await r.json())
      // the truth about the verdict (ETA, cancelled) comes from the chain, not from the exchange
      if (pending.txHash && client && receiver) {
        const v = (await client.readContract({
          address: receiver,
          abi: QuorumReceiverAbi,
          functionName: 'verdictOf',
          args: [pending.txHash],
        })) as Verdict
        setVerdict(v)
      }
    }, 2000)
    return () => clearInterval(t)
  }, [pending, d, user])

  /** docs/47 3.3: cancel my own queued withdrawal. The exchange relays the signature; if it will not, send it myself. */
  const cancelPending = async () => {
    if (!pending?.txHash || !signer || !user || !d) return
    const receiver = d.receivers[user.orgId.toLowerCase()]
    if (!receiver) return setMsg('Unknown org')
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
    const sig = await signer.wallet.signTypedData({
      account: signer.account,
      domain: cancelDomain(d.chainId, receiver),
      types: CancelWithdrawalTypes,
      primaryType: 'CancelWithdrawal',
      message: { txHash: pending.txHash, deadline },
    })
    const relayed = await fetch(`${API}/withdrawals/${pending.id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deadline: deadline.toString(), sig }),
    }).catch(() => undefined)
    if (relayed?.ok) return setMsg('Cancel sent.')
    try {
      await signer.wallet.writeContract({
        account: signer.account,
        chain,
        address: receiver,
        abi: QuorumReceiverAbi,
        functionName: 'userCancelVerdict',
        args: [pending.txHash, deadline, sig],
      })
      setMsg('Cancel sent from your wallet.')
    } catch (e) {
      setMsg(`Cancel failed: ${String((e as Error).message).slice(0, 160)}`)
    }
  }

  const label = (s?: string) =>
    s === 'pending' || s === 'manual'
      ? 'Processing'
      : s === 'executed'
        ? 'Sent'
        : s === 'rejected'
          ? 'Rejected'
          : s
            ? 'Submitted, waiting for confirmation'
            : ''

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <div className="text-lg font-semibold">Exchange Wallet</div>
      <div className="flex gap-2">
        {(['setup', 'deposit', 'withdraw', 'status'] as const).map((t) => (
          <button key={t} type="button" className={`btn ${tab === t ? 'btn-primary' : ''}`} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'setup' ? (
        <div className="card space-y-2">
          <div className="label">User id</div>
          <div className="flex gap-2">
            <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="ua-123456" />
            <button type="button" className="btn" onClick={loadUser}>
              Load
            </button>
          </div>
          <div className="label">Dev private key (testnet only; or leave empty to use an injected wallet)</div>
          <input type="password" className="mono" value={devKey} onChange={(e) => setDevKey(e.target.value.trim())} />
          <button type="button" className="btn" onClick={connect}>
            Connect
          </button>
          {myAddr ? <div className="mono text-xs">Signer {myAddr}</div> : null}
          {user ? (
            <div className="text-sm">
              Registered key: <span className="mono">{registered === ZERO ? 'none' : registered}</span>
              {registered === ZERO && signer ? (
                <button type="button" className="btn ml-2" onClick={register}>
                  Register my key
                </button>
              ) : null}
              {registered === ZERO ? (
                <button type="button" className="btn ml-2" onClick={registerPasskey}>
                  Use Face ID / fingerprint (passkey)
                </button>
              ) : null}
              {passkey ? <div className="mono text-xs">Passkey {passkey.keyId}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'deposit' || tab === 'withdraw' ? (
        <div className="card space-y-2">
          <div className="label">Token</div>
          <select value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })}>
            <option>qUSD</option>
            <option>qETH</option>
          </select>
          {tab === 'withdraw' ? (
            <>
              <div className="label">To address</div>
              <input
                className="mono"
                value={form.to}
                onChange={(e) => setForm({ ...form, to: e.target.value.trim() })}
              />
            </>
          ) : null}
          <div className="label">Amount</div>
          <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          {tab === 'deposit' ? (
            <button type="button" className="btn btn-primary" onClick={deposit}>
              Get test tokens and deposit
            </button>
          ) : intent ? (
            <>
              <div className="label mt-2">You are signing exactly this</div>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(intent).map(([k, v]) => (
                    <tr key={k}>
                      <td className="text-muted pr-3">{k}</td>
                      <td className="mono break-all">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="btn btn-primary" onClick={withdraw}>
                Sign and request withdrawal
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === 'status' ? (
        <div className="card">
          {status ? (
            <div>
              <div className="text-lg">
                {verdict?.released
                  ? 'Cancelled'
                  : verdict?.used || status.status === 'executed'
                    ? 'Sent'
                    : verdict?.decision === 1 && Number(verdict.notBefore) > Math.floor(Date.now() / 1000)
                      ? `Approved. Releases in ${Math.max(0, Number(verdict.notBefore) - Math.floor(Date.now() / 1000))} s`
                      : verdict?.decision === 1
                        ? 'Approved. Releasing'
                        : label(status.status)}
              </div>
              {verdict?.decision === 1 && !verdict.used && !verdict.released ? (
                <div className="mt-2 flex items-center gap-3">
                  <div className="text-sm text-muted">Not you? You can cancel until it is sent.</div>
                  <button type="button" className="btn" onClick={cancelPending}>
                    Cancel withdrawal
                  </button>
                </div>
              ) : null}
              {status.case_display ? <div className="mono text-sm text-muted">case {status.case_display}</div> : null}
            </div>
          ) : (
            <div className="text-muted">No request yet.</div>
          )}
        </div>
      ) : null}
      {msg ? <div className="text-sm text-muted">{msg}</div> : null}
    </div>
  )
}
