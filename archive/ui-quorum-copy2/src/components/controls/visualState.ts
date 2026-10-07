import type { Stage, Trigger } from "./data"

export const REPLAY_END = 26
export const eventTimes: Record<string, number> = {
  detected: 1,
  verification: 8,
  submitted: 10,
  accepted: 12,
  hot: 14,
  sweep: 16,
  warm: 18,
  cold: 20,
  registry: 24,
}
export type Scenario = "recorded" | "verification-failure" | "partial"
export function visualStages(
  trigger: Trigger,
  time: number,
  replay: boolean,
  scenario: Scenario,
  trustworthy: boolean,
): Stage[] {
  return trigger.stages.map((source) => {
    if (!trustworthy) return { ...source, state: "unavailable" }
    if (!replay) return source
    const at = eventTimes[source.id] ?? REPLAY_END
    if (time < 1) return { ...source, state: "inactive", time: "Not reached" }
    if (source.id === "verification" && time >= 3 && time < 8)
      return {
        ...source,
        state: "pending",
        time: "Demo +3s",
        evidence: "Simulated verification pending. Node telemetry unavailable.",
      }
    if (
      scenario === "verification-failure" &&
      time >= 8 &&
      source.id !== "detected"
    )
      return {
        ...source,
        state: source.id === "verification" ? "failed" : "skipped",
        evidence: "Synthetic failure rehearsal · not a recorded execution.",
        time: "Demo +8s",
        transactionId: undefined,
      }
    if (scenario === "partial" && time >= at && source.id === "warm")
      return {
        ...source,
        state: "failed",
        evidence: "Synthetic Warm action failure · no restriction confirmed.",
        time: `Demo +${at}s`,
        transactionId: undefined,
      }
    if (time < at)
      return {
        ...source,
        state:
          source.id === "detected"
            ? "inactive"
            : time >= 12 &&
                ["hot", "sweep", "warm", "cold", "registry"].includes(source.id)
              ? "pending"
              : "inactive",
        time: "Not reached",
      }
    return { ...source, time: `Demo +${at}s` }
  })
}
export function tone(state: string) {
  return state === "failed" || state === "detected"
    ? "#e88b7a"
    : state === "confirmed"
      ? "#b98d3c"
      : state === "pending"
        ? "#fcad17"
        : "#9a9488"
}
