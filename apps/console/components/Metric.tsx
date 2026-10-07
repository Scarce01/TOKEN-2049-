// Every number on the Console declares where it came from (D32). `source` is required by the type.
export type Source = 'testnet_measured' | 'public_onchain' | 'assumed' | 'chain_state'

const LABEL: Record<Source, string> = {
  testnet_measured: 'testnet measured',
  public_onchain: 'public on-chain',
  assumed: 'assumed',
  chain_state: 'chain state',
}

export function Metric(props: { label: string; value: string | number; unit?: string; source: Source; hint?: string }) {
  return (
    <div className="card">
      <div className="label">{props.label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {props.value}
        {props.unit ? <span className="ml-1 text-sm text-muted">{props.unit}</span> : null}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        <span className={`src src-${props.source}`}>{LABEL[props.source]}</span>
        {props.hint ? <span>{props.hint}</span> : null}
      </div>
    </div>
  )
}
