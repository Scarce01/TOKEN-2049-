"""Qu3ee Trap: Chainlink CRE + NOWNodes, as a runnable flow.

Mirrors workflows/trap/workflow.ts (onTransfer), workflows/trap/src/logic/{nownodes,decide}.ts,
packages/shared/src/report.ts (confirmedPack) and contracts/src/QuorumReceiver.sol (onReport).
Run: python docs/pitch/cre_nownodes_flow.py

  decoy Transfer log  (EVM log trigger, LATEST)
          |
          v
  CRE re-reads the receipt ------------- log not in receipt ----> no-op
          |
          v
  NOWNodes endpoint for this chain? ---- no (Base Sepolia, fork) -> act on CRE receipt
          | yes (Ethereum Sepolia)
          v
  every DON node: eth_getTransactionReceipt -> canonical text
          |
  identical consensus ------------------ error / null / nodes differ -> unavailable -> act on CRE receipt
          |
  trigger log in NOWNodes receipt? ----- no -> contradiction ----> no-op (D48)
          | yes
          v
  decideTrap -> confirmedPack: FREEZE warm, QUOTA_ZERO hot, SWEEP hot, ALERT 4, COLD_DELAY, THREAT
          |
          v
  writeReport -> KeystoneForwarder -> QuorumReceiver.onReport
          |   sender == forwarder, chainId, org, kind allowed, stale -> tightening only, each action isolated
          v
  warm frozen, hot quota 0, alert CONFIRMED, attacker in ThreatRegistry (dedup by evidence)
"""

from collections import Counter
from dataclasses import dataclass, field

TRANSFER = "0xddf252ad"
NOWNODES_URL = {11155111: "https://eth-sepolia.nownodes.io"}
UNAVAILABLE = "unavailable"
N_NODES, F = 4, 1


@dataclass(frozen=True)
class Log:
    address: str
    topics: tuple
    data: str
    index: int


def transfer_log(token, frm, to, amount, index=0):
    return Log(token, (TRANSFER, frm, to), hex(amount), index)


def rpc_receipt(status, logs):
    return {"result": {"status": hex(status), "logs": [
        {"address": l.address, "topics": list(l.topics), "data": l.data, "logIndex": hex(l.index)} for l in logs]}}


# ---- second source: nownodes.ts ----

def canonical_receipt(body):
    if "error" in body:
        raise RuntimeError("rpc error")
    r = body.get("result")
    if not r:
        return "miss"
    rows = sorted(f"{int(l['logIndex'], 16)}|{l['address'].lower()}|{','.join(t.lower() for t in l['topics'])}|{l['data'].lower()}"
                  for l in r["logs"])
    return f"ok|{int(r['status'], 16)}|{';'.join(rows)}"


def node_read(answer):
    try:
        if isinstance(answer, Exception):
            raise answer
        return canonical_receipt(answer)
    except Exception:
        return UNAVAILABLE


def identical_consensus(values):
    value, n = Counter(values).most_common(1)[0]
    if n < 2 * F + 1:
        raise ValueError("no consensus")
    return value


def second_source_verdict(canonical, log):
    if canonical in ("miss", UNAVAILABLE):
        return "unavailable"
    status, _, rows = canonical[3:].partition("|")
    needle = f"{log.index}|{log.address.lower()}|{','.join(t.lower() for t in log.topics)}|{log.data.lower()}"
    return "match" if status == "1" and needle in rows.split(";") else "contradiction"


# ---- decision: decide.ts + confirmedPack ----

@dataclass
class Report:
    chain_id: int
    org: str
    case_id: tuple
    issued_at: int
    actions: list


def decide_trap(log, tx, cfg, block_time):
    _, frm, to = log.topics
    amount = int(log.data, 16)
    if amount <= 0:
        return None
    org = cfg["decoy_wallets"].get(frm)
    if org is None:
        return None
    suspect = None if to in cfg["protected"] else to
    evidence = (cfg["chain_id"], tx, log.index)
    v = cfg["vaults"][org]
    actions = [
        ("FREEZE", (v["warm"], block_time + cfg["freeze_s"])),
        ("QUOTA_ZERO", v["hot"]),
        ("SWEEP", v["hot"]),
        ("ALERT", (4, block_time + cfg["alert_ttl_s"])),
        ("COLD_DELAY", cfg["cold_delay_s"]),
        ("THREAT", (suspect, evidence, block_time + cfg["threat_ttl_s"])),
    ]
    return Report(cfg["chain_id"], org, (org, *evidence), block_time, actions)


# ---- workflow handler: workflow.ts onTransfer ----

def on_transfer(log, tx, cfg, block_time, cre_receipt, nownodes_answers):
    if cre_receipt is None or cre_receipt["status"] != 1 or log not in cre_receipt["logs"]:
        return "no-op: receipt mismatch", None
    if NOWNODES_URL.get(cfg["chain_id"]):
        try:
            second = identical_consensus([node_read(a) for a in nownodes_answers])
        except ValueError:
            second = UNAVAILABLE
        if second_source_verdict(second, log) == "contradiction":
            return "no-op: nownodes mismatch", None
    report = decide_trap(log, tx, cfg, block_time)
    return ("tightened", report) if report else ("no-op", None)


# ---- chain: QuorumReceiver.onReport + ThreatRegistry ----

TIGHTENING = {"FREEZE", "QUOTA_ZERO", "SWEEP", "ALERT", "COLD_DELAY", "THREAT"}


@dataclass
class Receiver:
    org: str
    chain_id: int
    forwarder: str = "KeystoneForwarder"
    max_age_s: int = 600
    allowed: frozenset = frozenset(TIGHTENING)
    warm_frozen_until: int = 0
    hot_quota: int = 5_000
    hot_balance: int = 20_000
    cold_balance: int = 0
    alert: int = 0
    cold_delay_s: int = 0
    registry: dict = field(default_factory=dict)

    def on_report(self, sender, r, now):
        if sender != self.forwarder:
            raise PermissionError("NotForwarder")
        if r.chain_id != self.chain_id or r.org != self.org:
            raise ValueError("WrongChain/WrongOrg")
        stale = now > r.issued_at + self.max_age_s
        for kind, arg in r.actions:
            if kind not in self.allowed or (stale and kind not in TIGHTENING):
                continue
            try:
                getattr(self, "_" + kind.lower())(arg)
            except Exception:
                pass

    def _freeze(self, a): self.warm_frozen_until = max(self.warm_frozen_until, a[1])
    def _quota_zero(self, _): self.hot_quota = 0
    def _sweep(self, _): self.cold_balance, self.hot_balance = self.cold_balance + self.hot_balance, 0
    def _alert(self, a): self.alert = max(self.alert, a[0])
    def _cold_delay(self, s): self.cold_delay_s = max(self.cold_delay_s, s)

    def _threat(self, a):
        suspect, evidence, expires = a
        if suspect and evidence not in self.registry:
            self.registry[evidence] = (suspect, expires)

    def snapshot(self):
        return (self.warm_frozen_until > 0, self.hot_quota, self.alert, len(self.registry))


# ---- scenarios ----

def run():
    eth_sepolia = {
        "chain_id": 11155111, "decoy_wallets": {"0xdecoy": "A"}, "protected": {"0xcold"},
        "vaults": {"A": {"hot": "0xhot", "warm": "0xwarm"}},
        "freeze_s": 7_200, "alert_ttl_s": 7_200, "cold_delay_s": 259_200, "threat_ttl_s": 259_200,
    }
    base_sepolia = {**eth_sepolia, "chain_id": 84532}
    probe = transfer_log("0xqusd", "0xdecoy", "0xattacker", 1_000_000)
    forged = transfer_log("0xqusd", "0xdecoy", "0xattacker", 9_999_999)
    cre_ok = {"status": 1, "logs": [probe]}
    nn_ok = rpc_receipt(1, [probe])
    t0 = 1_791_000_000

    cases = [
        ("decoy touched, NOWNodes agrees", eth_sepolia, cre_ok, [nn_ok] * N_NODES, "tightened"),
        ("forged log, NOWNodes contradicts", eth_sepolia, {"status": 1, "logs": [forged]}, [nn_ok] * N_NODES, "no-op: nownodes mismatch"),
        ("NOWNodes down", eth_sepolia, cre_ok, [ConnectionError()] * N_NODES, "tightened"),
        ("nodes see different NOWNodes answers", eth_sepolia, cre_ok, [nn_ok, nn_ok, {"result": None}, ConnectionError()], "tightened"),
        ("Base Sepolia, no NOWNodes endpoint", base_sepolia, cre_ok, [], "tightened"),
        ("log not in the CRE receipt", eth_sepolia, {"status": 1, "logs": []}, [nn_ok] * N_NODES, "no-op: receipt mismatch"),
    ]
    for name, cfg, cre_receipt, answers, want in cases:
        log = forged if "forged" in name else probe
        outcome, report = on_transfer(log, "0xprobe", cfg, t0, cre_receipt, answers)
        rx = Receiver("A", cfg["chain_id"])
        if report:
            rx.on_report("KeystoneForwarder", report, t0 + 10)
        print(f"{name:40s} -> {outcome:26s} frozen,quota,alert,threats={rx.snapshot()}")
        assert outcome == want, (name, outcome)

    _, report = on_transfer(probe, "0xprobe", eth_sepolia, t0, cre_ok, [nn_ok] * N_NODES)
    rx = Receiver("A", eth_sepolia["chain_id"])
    try:
        rx.on_report("exchange-admin", report, t0 + 10)
    except PermissionError as e:
        print(f"{'exchange admin calls the receiver':40s} -> {e}")
    rx.on_report("KeystoneForwarder", report, t0 + 10)
    first = rx.snapshot()
    rx.on_report("KeystoneForwarder", report, t0 + 20)
    print(f"{'same report delivered twice':40s} -> {rx.snapshot()} (unchanged)")
    assert rx.snapshot() == first == (True, 0, 4, 1)


if __name__ == "__main__":
    run()
