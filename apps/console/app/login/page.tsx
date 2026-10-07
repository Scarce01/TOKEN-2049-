'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { supabase } from '@/lib/client'

export default function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const router = useRouter()

  async function send() {
    setErr('')
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
    if (error) setErr(error.message)
    else setSent(true)
  }
  async function verify() {
    setErr('')
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) setErr(error.message)
    else router.push('/')
  }

  return (
    <div className="mx-auto mt-24 max-w-sm card">
      <div className="mb-4 text-lg font-semibold">Qu3ee Console</div>
      <div className="label mb-1">Officer email</div>
      <input
        className="w-full"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="officer@exchange.example"
      />
      {sent ? (
        <>
          <div className="label mb-1 mt-3">One-time code</div>
          <input className="w-full mono" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="button" className="btn btn-primary mt-3 w-full" onClick={verify}>
            Verify
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-primary mt-3 w-full" onClick={send}>
          Send code
        </button>
      )}
      {err ? <div className="mt-2 text-sm text-bad">{err}</div> : null}
      <p className="mt-4 text-xs text-muted">Only accounts with the officer role can open the Console.</p>
    </div>
  )
}
