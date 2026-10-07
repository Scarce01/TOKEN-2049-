import { OfficerActionTypes, officerDomain } from '@quorum/shared'
import { type Address, type Hex, recoverTypedDataAddress } from 'viem'
import { deployment, json, requireOfficer, sql } from '@/lib/server'

export async function GET(req: Request) {
  const o = await requireOfficer(req)
  if (o instanceof Response) return o
  return json(
    await sql()`select * from quorum_index.officer_signatures where created_at > now() - interval '2 days' order by created_at desc`,
  )
}

/** Stores a signature *as the officer*: SET ROLE authenticated + verified JWT claims, so RLS decides. */
export async function POST(req: Request) {
  const o = await requireOfficer(req)
  if (o instanceof Response) return o
  const b = (await req.json()) as {
    target: Address
    kind: number
    subject: Hex
    value: string
    nonce: string
    deadline: string
    officer: Address
    sig: Hex
  }
  const d = deployment()
  const signer = await recoverTypedDataAddress({
    domain: officerDomain(d.chainId, b.target),
    types: OfficerActionTypes,
    primaryType: 'OfficerAction',
    message: {
      kind: b.kind,
      subject: b.subject,
      value: BigInt(b.value),
      nonce: BigInt(b.nonce),
      deadline: BigInt(b.deadline),
    },
    signature: b.sig,
  })
  if (signer.toLowerCase() !== b.officer.toLowerCase()) return json({ error: 'signature does not match officer' }, 400)
  await sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(o.claims)}, true)`
    await tx.unsafe('set local role authenticated')
    await tx`insert into quorum_index.officer_signatures (target_contract, action_kind, subject, value, nonce, deadline, officer, sig)
             values (${b.target}, ${b.kind}, ${b.subject}, ${b.value}, ${b.nonce}, ${b.deadline}, ${signer}, ${b.sig})
             on conflict do nothing`
  })
  return json({ ok: true, signer })
}
