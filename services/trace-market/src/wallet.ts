// Creates the two Cardano preprod test wallets: the Investigator (payer) and the Trace Agent (payee).
// Mnemonics go only into git-ignored files (.env.investigator, .env.payee); only addresses are printed.
// The seller process loads .env alone, so it never sees a key.
import { existsSync, writeFileSync } from 'node:fs'
import { Address, PrivateKey } from '@evolution-sdk/evolution'
import { addressFromSeed } from '@evolution-sdk/evolution/sdk/wallet/Derivation'

const at = (f: string) => new URL(`../${f}`, import.meta.url)
if (existsSync(at('.env.investigator'))) throw new Error('wallets already exist (.env.investigator); not overwriting')

const make = () => {
  const mnemonic = PrivateKey.generateMnemonic()
  return { mnemonic, address: Address.toBech32(addressFromSeed(mnemonic, { networkId: 0 }).address) }
}
const payer = make()
const payee = make()

writeFileSync(at('.env.investigator'), `MNEMONIC=${payer.mnemonic}\n`)
writeFileSync(at('.env.payee'), `# recovery only: nothing in this service loads it\nPAYEE_MNEMONIC=${payee.mnemonic}\n`)
writeFileSync(
  at('.env'),
  [
    'FACILITATOR_URL=https://x402.preprod.dev.ecosyseng.cf-deployments.org',
    `SELLER_ADDRESS=${payee.address}`,
    'SELLER_PORT=4021',
    'SELLER_URL=http://localhost:4021',
    'KOIOS_URL=https://preprod.koios.rest/api/v1',
    '',
  ].join('\n'),
)
console.log(`Investigator (payer): ${payer.address}`)
console.log(`Trace Agent (payee):  ${payee.address}`)
console.log('Fund the payer: https://docs.cardano.org/cardano-testnets/tools/faucet (preprod)')
