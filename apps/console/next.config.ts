import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@quorum/shared'],
  // postgres is server-only (console_svc); never bundled for the browser
  serverExternalPackages: ['postgres'],
}
export default config
