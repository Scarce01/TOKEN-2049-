// Red team talks only to our local exchange API and to Ethereum Sepolia.

const BANNED_HOST_PARTS = ['binance', 'bybit', 'okx', 'coinbase', 'kraken']

export function assertLocalExchange(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('exchange api url is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('exchange api url must be http(s)')
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('redteam only calls the local exchange-api')
  }
  return url
}

export function assertSepoliaTarget(chainId: number, rpc: string): void {
  if (chainId !== 11155111) throw new Error('redteam attack only runs on ethereum sepolia')
  let host: string
  try {
    host = new URL(rpc).hostname.toLowerCase()
  } catch {
    throw new Error('rpc url is invalid')
  }
  if (BANNED_HOST_PARTS.some((part) => host.includes(part))) throw new Error('refusing this rpc host')
  const local = host === '127.0.0.1' || host === 'localhost'
  if (!local && !host.includes('sepolia')) throw new Error('rpc host must be sepolia or local')
}
