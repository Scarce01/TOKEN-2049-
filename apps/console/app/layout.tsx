import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import { Shell } from '@/components/Shell'
import { deployment } from '@/lib/server'
import './globals.css'

export const metadata: Metadata = { title: 'Qu3ee Console', description: 'Exchange withdrawal second line of defense' }
export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const d = deployment()
  return (
    <html lang="en">
      <body>
        <Providers deployment={d}>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  )
}
