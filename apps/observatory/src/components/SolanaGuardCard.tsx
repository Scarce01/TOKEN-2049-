// Cross-chain enforcement on Solana devnet (solana/, Token-2022 transfer hook). Reads the evidence pnpm solana:demo
// writes (data/solana_guard.json) and renders nothing until a run exists. Every value is LIVE TESTNET: the threat
// came from a CRE report on Ethereum Sepolia; the before/after transfers are on Solana devnet.
import { Panel, Row } from './ui'

type Run = {
  programId: string
  asset: string
  mint: string
  guardPda: string
  before: { transferSignature: string; explorer: string }
  containment: { reportTx: string; reportBlock: number; evidenceHash: string; stateTx: string; explorer: string }
  after: { mode: string; transferSignature: string; explorer: string }
}

const run = Object.values(import.meta.glob<{ default: Run }>('../data/solana_guard.json', { eager: true }))[0]?.default
const short = (s: string, a = 8, b = 6) => `${s.slice(0, a)}…${s.slice(-b)}`
const Link = ({ href, children }: { href: string; children: string }) => (
  <a href={href} target="_blank" rel="noreferrer" className="font-mono text-honey hover:underline">{children}</a>
)

export default function SolanaGuardCard() {
  if (!run) return null
  return (
    <Panel
      title="Cross-chain enforcement · Solana Guard"
      className="mt-5"
      action={<span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">Live testnet · devnet</span>}
    >
      <div className="px-5 pb-5">
        <p className="mb-3 text-[12.5px] text-dim">
          Same asset, same sender, same recipient. The transfer works before QUBEE containment and fails on-chain after
          the threat reaches Solana.
        </p>
        <dl>
          <Row k="Program"><Link href={`https://explorer.solana.com/address/${run.programId}?cluster=devnet`}>{short(run.programId)}</Link></Row>
          <Row k="Asset">{run.asset} · Token-2022 with transfer hook</Row>
          <Row k="Before threat">
            <span className="text-honey">TRANSFER ALLOWED</span> · <Link href={run.before.explorer}>{short(run.before.transferSignature)}</Link>
          </Row>
          <Row k="Threat source">
            Ethereum Sepolia · block {run.containment.reportBlock.toLocaleString('en-US')} ·{' '}
            <Link href={`https://sepolia.etherscan.io/tx/${run.containment.reportTx}`}>{short(run.containment.reportTx, 10)}</Link>
          </Row>
          <Row k="Evidence" mono>{short(run.containment.evidenceHash, 12)}</Row>
          <Row k="Current state">
            <span className="text-wax">{run.after.mode}</span> · <Link href={run.containment.explorer}>{short(run.containment.stateTx)}</Link>
          </Row>
          <Row k="After threat">
            <span className="text-wax">TRANSFER REJECTED</span> · <Link href={run.after.explorer}>{short(run.after.transferSignature)}</Link>
          </Row>
        </dl>
      </div>
    </Panel>
  )
}
