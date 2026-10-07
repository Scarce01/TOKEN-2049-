import type { AttackStep } from './attackFeed'

export type CreLine = {
  id: string
  time: string
  label: string
  message: string
  meta: string
  tone: string
}

const SECRET = /secret|token|bearer|authorization|private key|aws_access/i

export function presentStep(step: AttackStep, startedAt: number): CreLine {
  const label = labelOf(step)
  return {
    id: `${startedAt}:${step.seq}`,
    time: timeOf(step.at),
    label,
    message: safeText(step.detail || step.message || fallback(step)),
    meta: metaOf(step),
    tone: toneOf(label, step),
  }
}

export function truncateRef(value: string): string {
  if (value.length < 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function labelOf(step: AttackStep): string {
  if (step.type === 'error') return 'ERROR'
  if (step.event === 'ThreatAdded' || step.event === 'AlertSet') return 'THREAT'
  if (step.event === 'QuotaZeroed' || step.event === 'DelayRaised') return 'POLICY'
  if (step.type === 'response') return 'ONCHAIN'
  if (step.phase === 'tripwire') return 'TRAP'
  if (step.phase === 'verify') return 'CRE'
  if (step.phase === 'verified' || step.type === 'done') return 'VERIFY'
  if (step.phase === 'report') return 'ONCHAIN'
  return 'CRE'
}

function toneOf(label: string, step: AttackStep): string {
  if (label === 'THREAT') return 'text-[#ff8a8d]'
  if (label === 'ERROR') return 'text-[#c46a66]'
  if (label === 'VERIFY') return 'text-[#72d7ac]'
  if (label === 'POLICY' || label === 'TRAP' || step.phase === 'verify') return 'text-[#E2B52E]'
  if (label === 'ONCHAIN') return 'text-[#8eb4bc]'
  return 'text-mute'
}

function fallback(step: AttackStep): string {
  if (step.type === 'start') return 'Attack flow started'
  if (step.type === 'done') return 'Containment finished'
  return 'CRE runtime event'
}

function metaOf(step: AttackStep): string {
  const parts: string[] = []
  if (step.tx && /^0x[0-9a-fA-F]+$/.test(step.tx)) parts.push(truncateRef(step.tx))
  if (typeof step.block === 'number') parts.push(`block ${step.block}`)
  return parts.join('  ')
}

function safeText(value: string): string {
  if (SECRET.test(value)) return 'Runtime event withheld'
  return value.replace(/0x[0-9a-fA-F]{20,}/g, (hash) => truncateRef(hash)).slice(0, 220)
}

function timeOf(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--:--'
  return new Date(ms).toISOString().slice(11, 19)
}
