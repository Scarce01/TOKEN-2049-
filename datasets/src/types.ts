/** One exchange account as the backend sees it. No field marks decoys. */
export type Account = {
  org: 'a' | 'b'
  userId: string
  displayName: string
  kycLevel: number
  regDays: number
  activity: number
  depFreq: number
  wdFreq: number
  balanceUsd: number
  deposits: { qUSD: string; qETH: string } // smallest units
}
