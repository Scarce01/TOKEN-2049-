import { DECOYS as BASE, type Decoy } from "../mock"

export type FieldDecoy = Decoy & { x: number; z: number; agency: string }
export type Agency = { id: string; name: string; x: number; z: number; protected: boolean; vault: number }

export const CORE: [number, number] = [0, 0]
export const AGENCIES: Agency[] = [
  { id: "exA", name: "Exchange A", x: -9, z: 4, protected: true, vault: 3 },
  { id: "exB", name: "Exchange B", x: 9, z: 5, protected: true, vault: 2 },
  { id: "kes", name: "Kestrel Custody", x: -7, z: -8, protected: true, vault: 3 },
  { id: "mer", name: "Meridian DAO", x: 8, z: -7, protected: true, vault: 1 },
  { id: "hal", name: "Halcyon Pay", x: 1, z: 12, protected: true, vault: 2 },
  { id: "unA", name: "Agency F", x: -17, z: -2, protected: false, vault: 0 },
  { id: "unB", name: "Agency G", x: 17, z: -1, protected: false, vault: 0 },
]
const EXTRA: Decoy[] = [
  { id: "DK-17", type: "API key", label: "Custody settlement key", ref: "kc_live_…a03", host: "Kestrel Custody", state: "Armed", deployed: "Sep 25", hits: 0, lastHit: "—", commit: "0x6e21…c4d0", lure: 0.78 },
  { id: "DC-12", type: "Credential", label: "Signer backup share", ref: "vault/kc/share.3", host: "Kestrel Custody", state: "Rotating", deployed: "Oct 02", hits: 0, lastHit: "—", commit: "0x0b7f…19ae", lure: 0.66 },
  { id: "DT-08", type: "Threshold", label: "Treasury quorum band", ref: "gov.quorum_band", host: "Meridian DAO", state: "Armed", deployed: "Sep 18", hits: 0, lastHit: "—", commit: "0xa90c…4e52", lure: 0.74 },
  { id: "DA-31", type: "Account", label: "Merchant payout admin", ref: "acct HP-031", host: "Halcyon Pay", state: "Armed", deployed: "Sep 29", hits: 0, lastHit: "—", commit: "0x3d18…b6f9", lure: 0.81 },
  { id: "DX-40", type: "Address", label: "Refund sweep address", ref: "0x2bd4…e710", host: "Halcyon Pay", state: "Retired", deployed: "May 11", hits: 0, lastHit: "—", commit: "0xf102…7a3c", lure: 0.4 },
]
const SPOTS = [[0, 0], [2.2, -1.4], [-2.2, -1.2], [1.6, 2], [-1.8, 2.1], [2.6, 0.9]]
const used: Record<string, number> = {}
export const DECOYS: FieldDecoy[] = [...BASE, ...EXTRA].map((d) => {
  const a = AGENCIES.find((x) => x.name === d.host)!
  const i = (used[a.id] = (used[a.id] ?? -1) + 1)
  const [dx, dz] = SPOTS[(i + 1) % SPOTS.length]
  return { ...d, agency: a.id, x: a.x + dx * 1.3, z: a.z + dz * 1.3 }
})
export const ROTATION: Record<Decoy["type"], string> = {
  Wallet: "Rotate on touch · 90d max", Account: "60d · on touch", Address: "30d", "API key": "45d", Threshold: "7d · randomized band", Credential: "90d · canary refresh",
}
export const confidence = (d: Decoy) => (d.hits ? (d.type === "Account" ? "High · enumeration" : "Deterministic") : "—")
export const HISTORY = [
  { t: "14:02:07", id: "DW-07", act: "Outbound transfer signed from lure wallet", agency: "Exchange A", flow: "Incident QRM-78452 · vaults tightened", level: "threat" as const },
  { t: "14:01:52", id: "DA-114", act: "Credential enumeration · 3 login probes", agency: "Exchange A", flow: "Merged into QRM-78452", level: "threat" as const },
  { t: "14:02:31", id: "DW-07", act: "Signal propagated to 4 protected agencies", agency: "Quorum network", flow: "ThreatRegistry #4,118 · all acks", level: "active" as const },
  { t: "09:40:00", id: "DT-02", act: "Scheduled rotation started", agency: "Exchange A", flow: "New commitment pending 24h", level: "warning" as const },
  { t: "Aug 14", id: "DW-02", act: "Legacy hot wallet touched · retired", agency: "Exchange A", flow: "Closed · QRM-71904", level: "idle" as const },
]
