'use client'
// Browser-side: Supabase auth (anon key only), chain client, block-keyed reads (D47, D59).
import type { Deployment } from '@quorum/shared/deployments'
import { createClient, type Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState } from 'react'
import { createPublicClient, http, type PublicClient } from 'viem'
import { baseSepolia, foundry } from 'viem/chains'

export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

export const DeploymentCtx = createContext<Deployment | null>(null)
export function useDeployment(): Deployment {
  const d = useContext(DeploymentCtx)
  if (!d) throw new Error('deployment missing')
  return d
}

let _pub: PublicClient | undefined
export function pub(d: Deployment): PublicClient {
  if (!_pub) {
    _pub = createPublicClient({
      chain: d.chainId === 31337 ? foundry : baseSepolia,
      transport: http(process.env.NEXT_PUBLIC_RPC_URL),
      batch: { multicall: true },
    }) as PublicClient
  }
  return _pub
}

/** One getBlockNumber poll per ~2 s block; every chain read below keys on it. */
export function useBlock(): bigint | undefined {
  const d = useDeployment()
  return useQuery({
    queryKey: ['block'],
    queryFn: () => pub(d).getBlockNumber({ cacheTime: 0 }),
    refetchInterval: 2000,
  }).data
}

/** Chain read cached per block: a new block is the only thing that invalidates it. */
export function useChain<T>(key: unknown[], fn: (block: bigint) => Promise<T>) {
  const block = useBlock()
  return useQuery({
    queryKey: [...key, block?.toString()],
    queryFn: () => fn(block!),
    enabled: block !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: (prev) => prev,
  })
}

export function useSession(): Session | null | undefined {
  const [s, setS] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setS(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, sess) => setS(sess))
    return () => data.subscription.unsubscribe()
  }, [])
  return s
}

export function isOfficer(s: Session | null | undefined): boolean {
  return s?.user.app_metadata?.role === 'officer'
}

/** Authenticated fetch to the Console server routes. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${data.session?.access_token ?? ''}`,
      'content-type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

export function useApi<T>(path: string | null, refetchMs = 10_000) {
  const s = useSession()
  return useQuery({
    queryKey: ['api', path],
    queryFn: () => api<T>(path!),
    enabled: !!path && isOfficer(s),
    refetchInterval: refetchMs,
  })
}

// ---------- recording mode: mask decoy refs (D29) ----------
export const RecordingCtx = createContext<{ on: boolean; refs: Set<string>; toggle: () => void }>({
  on: false,
  refs: new Set(),
  toggle: () => {},
})

export function useMask() {
  const r = useContext(RecordingCtx)
  return (v: string | null | undefined): string => {
    if (!v) return ''
    if (r.on && r.refs.has(v.toLowerCase())) return `${v.slice(0, 6)}...[masked]`
    return v
  }
}

export const short = (h?: string | null, n = 6) => (h ? `${h.slice(0, 2 + n)}...${h.slice(-4)}` : '')

export function explorerTx(d: Deployment, h: string) {
  return d.chainId === 84532 ? `https://sepolia.basescan.org/tx/${h}` : `#${h}`
}

export function useNow(): number {
  const [n, setN] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setN(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  return n
}

export function countdown(until: bigint | number, now: number): string {
  const s = Number(until) - now
  if (s <= 0) return 'expired'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`
}

import { displayCase } from '@quorum/shared'
export const displayCaseOf = (c: string) => displayCase(c as `0x${string}`)
