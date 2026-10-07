// Compromised signing path. The hot-wallet key is decrypted here and never returned.
import { type Address, createWalletClient, erc20Abi, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { pub } from './chain'
import { decryptKey } from './crypto'
import { sql, T } from './db'
import { deployment, env } from './env'

export async function signProbe(address: Address, to: Address, amount: bigint): Promise<Hex> {
  const [row] =
    await sql`select private_key_enc from ${T('hot_wallets')} where lower(address) = lower(${address}) and status = 'active'`
  if (!row?.private_key_enc) throw new Error('unknown wallet')
  const account = privateKeyToAccount(decryptKey(env.hotWalletEncKey, row.private_key_enc))
  if (account.address.toLowerCase() !== address.toLowerCase()) throw new Error('stored key does not match address')
  const chain = pub.chain
  if (!chain) throw new Error('rpc chain is not set')
  const wallet = createWalletClient({ account, chain, transport: http(env.rpcUrl) })
  const hash = await wallet.writeContract({
    address: deployment.qUSD,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
    account,
    chain,
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('transfer reverted')
  return hash
}
