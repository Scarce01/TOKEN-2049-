// Pure: chain facts -> user notifications (docs/47 3.5, docs/46 section 5 "independent notification").
// The notifier decides nothing and never sees the decoy list; it only tells the user what the chain says,
// so a compromised exchange app cannot hide a withdrawal it forged or a payout it delayed.
import type { Address, Hex } from 'viem'

export type Req = { txHash: Hex; userIdHash: Hex; to: Address; amount: bigint; token: Address }
export type Ev =
  | { kind: 'verdict'; txHash: Hex; decision: number; notBefore: bigint }
  | { kind: 'held'; txHash: Hex; until: bigint }
  | { kind: 'userCancelled'; txHash: Hex }
  | { kind: 'officerCancelled'; txHash: Hex }
  | { kind: 'paid'; txHash: Hex }
export type Note = { txHash: Hex; userIdHash: Hex; kind: string; text: string }
export type TokenInfo = (token: Address) => { symbol: string; decimals: number }

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function fmtAmount(x: bigint, decimals: number): string {
  const whole = x / 10n ** BigInt(decimals)
  const frac = (x % 10n ** BigInt(decimals)).toString().padStart(decimals, '0').slice(0, 2).replace(/0+$/, '')
  return whole.toLocaleString('en-US') + (frac ? `.${frac}` : '')
}

const mins = (s: bigint) => Math.max(1, Math.ceil(Number(s) / 60))

export function notificationsFor(reqs: Map<Hex, Req>, evs: Ev[], now: bigint, tokenInfo: TokenInfo): Note[] {
  const out: Note[] = []
  for (const e of evs) {
    const r = reqs.get(e.txHash)
    if (!r) continue
    const t = tokenInfo(r.token)
    const what = `Withdrawal of ${fmtAmount(r.amount, t.decimals)} ${t.symbol} to ${short(r.to)}`
    const note = (kind: string, text: string) => out.push({ txHash: e.txHash, userIdHash: r.userIdHash, kind, text })
    if (e.kind === 'verdict') {
      if (e.decision === 1 && e.notBefore > now)
        note(
          'delayed',
          `${what} releases in ${mins(e.notBefore - now)} min. Not you? Cancel it in the app before then.`,
        )
      else if (e.decision === 1) note('approved', `${what} is approved and will be sent shortly.`)
      else if (e.decision === 3)
        note('pending', `${what} is paused for a security check. Your funds stay in your account.`)
      else if (e.decision === 2)
        note(
          'rejected',
          `A withdrawal request in your name (${what.slice(14)}) was rejected: the signature was not yours. If you did not request it, contact support.`,
        )
    } else if (e.kind === 'held')
      note(
        'held',
        `${what} is paused until ${new Date(Number(e.until) * 1000).toISOString().slice(11, 16)} UTC for a security check.`,
      )
    else if (e.kind === 'userCancelled') note('cancelled', `${what} was cancelled by you.`)
    else if (e.kind === 'officerCancelled') note('cancelled', `${what} was cancelled by the security team.`)
    else if (e.kind === 'paid') note('paid', `${what} was sent.`)
  }
  return out
}
