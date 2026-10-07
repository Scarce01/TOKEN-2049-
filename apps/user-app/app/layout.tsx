import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Exchange Wallet', description: 'Sign your own withdrawals' }
export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Only public contract addresses reach the browser.
  const d = JSON.parse(
    readFileSync(
      join(process.cwd(), '..', '..', 'deployments', `${process.env.DEPLOY_NAME ?? 'base-sepolia'}.json`),
      'utf8',
    ),
  )
  const pub = {
    chainId: d.chainId,
    keyRegistry: d.keyRegistry,
    depositVault: d.depositVault,
    requestBoard: d.requestBoard,
    faucet: d.faucet,
    qUSD: d.qUSD,
    qETH: d.qETH,
    // orgId -> Receiver: the app reads its own verdict (ETA, cancelled) from the chain, not from the backend
    receivers: Object.fromEntries(
      [d.orgA, d.orgB]
        .filter(Boolean)
        .map((o: { orgId: string; receiver: string }) => [o.orgId.toLowerCase(), o.receiver]),
    ),
  }
  return (
    <html lang="en">
      <body>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static public addresses
          dangerouslySetInnerHTML={{ __html: `window.__DEPLOYMENT__=${JSON.stringify(pub)}` }}
        />
        {children}
      </body>
    </html>
  )
}
