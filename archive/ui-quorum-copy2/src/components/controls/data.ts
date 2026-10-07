import {
  APPROVALS,
  CONFIG_CHANGES,
  DECOYS,
  REQUESTS,
  RUNS,
  VAULTS,
  REPORTS,
} from "../mock"

export type Connection = "loading" | "demo" | "stale" | "disconnected" | "failed" | "permission-denied"
export type StageState = "detected" | "pending" | "confirmed" | "failed" | "skipped" | "unavailable" | "inactive"
export type Stage = {
  id: string
  name: string
  state: StageState
  time: string
  evidence: string
  transactionId?: string
  objectId?: string
}
export type Trigger = {
  id: string
  decoyId: string
  label: string
  exchange: string
  time: string
  status: string
  incidentId?: string
  requestIds: string[]
  runId?: string
  reportId?: string
  stages: Stage[]
}
export type Snapshot = {
  updatedAt: string
  connection: Connection
  triggers: Trigger[]
  vaults: typeof VAULTS
  requests: typeof REQUESTS
  approvals: typeof APPROVALS
  proposals: typeof CONFIG_CHANGES
  runs: typeof RUNS
  reports: typeof REPORTS
}
export interface ControlsAdapter {
  read(signal: AbortSignal): Promise<Snapshot>
  subscribe?: (receive: (snapshot: Snapshot) => void) => () => void
}

const stages: Stage[] = [
  {
    id: "detected",
    name: "Trigger detected",
    state: "detected",
    time: "14:02:07",
    evidence: "DW-07 transfer · block 21,904,118",
  },
  {
    id: "verification",
    name: "CRE verification",
    state: "confirmed",
    time: "14:02:19 · +12s",
    evidence: "Demo signed Trap report. Per-node CRE telemetry: Unavailable.",
  },
  {
    id: "submitted",
    name: "Report submitted",
    state: "confirmed",
    time: "14:02:24",
    evidence: "Demo report #78452 submitted to QuorumReceiver.",
  },
  {
    id: "accepted",
    name: "Receiver acceptance",
    state: "confirmed",
    time: "14:02:31",
    evidence:
      "Demo receiver acceptance result for report #78452. Action results tracked independently.",
  },
  {
    id: "hot",
    objectId: "hot",
    name: "Hot quota → 0 ETH",
    state: "confirmed",
    time: "14:02:31",
    transactionId: "0x41e0…c2a7",
    evidence: "Demo action result and matching quota snapshot: 0 ETH.",
  },
  {
    id: "sweep",
    objectId: "cold",
    name: "Sweep → Cold",
    state: "confirmed",
    time: "14:02:31",
    transactionId: "0x9d3a…7f10",
    evidence:
      "Demo action result: 1,120 ETH swept. Live balance reconciliation unavailable.",
  },
  {
    id: "warm",
    objectId: "warm",
    name: "Warm Cosign-only",
    state: "confirmed",
    time: "14:02:31",
    transactionId: "0x77b1…0e3c",
    evidence:
      "Demo action result and restriction snapshot: Cosign-only until 20:02 UTC.",
  },
  {
    id: "cold",
    objectId: "cold",
    name: "Cold wait → 72h",
    state: "confirmed",
    time: "14:02:32",
    transactionId: "0x0c5f…a991",
    evidence: "Demo action result and timelock snapshot: 72h.",
  },
  {
    id: "registry",
    name: "Registry publication",
    state: "confirmed",
    time: "14:02:38",
    transactionId: "0x2f9c…b8e3",
    evidence:
      "Demo entry #4,118. Shared intelligence only; no automatic global freeze.",
  },
]

export const demoControlsAdapter: ControlsAdapter = {
  async read(signal) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    return {
      updatedAt: "2026-10-05T14:03:02Z",
      connection: "demo",
      triggers: DECOYS.map(
        (decoy): Trigger => ({
          id: `trigger-${decoy.id}`,
          decoyId: decoy.id,
          label: decoy.label,
          exchange: decoy.host,
          time: decoy.lastHit.replace(" today", ""),
          status:
            decoy.id === "DW-07"
              ? "Response confirmed"
              : decoy.id === "DA-114"
                ? "Evidence unavailable"
                : decoy.state,
          incidentId: decoy.state === "Triggered" ? "QRM-78452" : undefined,
          requestIds:
            decoy.state === "Triggered" ? ["RB-310944", "RB-310947"] : [],
          runId:
            decoy.id === "DW-07"
              ? RUNS.find((run) => run.wf === "Trap")?.id
              : undefined,
          reportId: decoy.id === "DW-07" ? "#78452" : undefined,
          stages:
            decoy.id === "DW-07"
              ? stages
              : stages.map((stage) => ({
                  ...stage,
                  state:
                    stage.id === "detected" && decoy.state === "Triggered"
                      ? "detected"
                      : decoy.state === "Triggered"
                        ? "unavailable"
                        : "inactive",
                  time: stage.id === "detected" ? decoy.lastHit : "Unavailable",
                  evidence:
                    "No associated stage evidence in the demo snapshot.",
                  transactionId: undefined,
                })),
        }),
      ).sort(
        (first, second) =>
          Number(second.status === "Evidence unavailable") -
          Number(first.status === "Evidence unavailable"),
      ),
      vaults: VAULTS,
      requests: REQUESTS,
      approvals: APPROVALS,
      proposals: CONFIG_CHANGES,
      runs: RUNS,
      reports: REPORTS,
    }
  },
}
