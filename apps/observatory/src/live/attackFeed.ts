import { useEffect, useState } from 'react'
import { BRIDGE } from './bridge'

export type AttackStep = {
  seq: number
  at: number
  type: 'start' | 'step' | 'response' | 'done' | 'error'
  phase?: string
  org?: string
  detail?: string
  tx?: string
  block?: number
  cre?: string
  nownodes?: string
  verdict?: string
  event?: string
  message?: string
}

export type AttackStatus = { running: boolean; startedAt?: number; steps: AttackStep[] }
export type AttackLink = 'connected' | 'reconnecting' | 'disconnected'
export type AttackFeed = { status?: AttackStatus; link: AttackLink }

type Listener = (feed: AttackFeed) => void

let timer: ReturnType<typeof setTimeout> | undefined
let feed: AttackFeed = { link: 'reconnecting' }
const listeners = new Set<Listener>()

async function tick() {
  try {
    const response = await fetch(`${BRIDGE}/attack/status`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`bridge http ${response.status}`)
    const status = (await response.json()) as AttackStatus
    feed = { status, link: 'connected' }
  } catch {
    feed = { status: feed.status, link: feed.status ? 'reconnecting' : 'disconnected' }
  }
  for (const listener of listeners) listener(feed)
  if (listeners.size === 0) return
  timer = setTimeout(() => void tick(), feed.status?.running ? 600 : 2000)
}

/** One poll of the fork bridge attack log, shared by the timeline and the CRE console. */
export function subscribeAttack(listener: Listener) {
  listeners.add(listener)
  listener(feed)
  if (listeners.size === 1) void tick()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }
}

export function useAttackFeed() {
  const [current, setCurrent] = useState<AttackFeed>(feed)
  useEffect(() => subscribeAttack(setCurrent), [])
  return current
}
