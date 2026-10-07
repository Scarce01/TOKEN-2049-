"""Qu3ee on Cardano: x402 paid forensic trace (Preprod), as a runnable flow.

Mirrors services/trace-market/src/{server,investigator,policy,trace}.ts and the @x402/cardano 2.26.0 exact scheme
(client build/sign, facilitator verify/settle). Trace data: services/trace-market/data/trace_index.json (REPLAY).
Run: python docs/pitch/cardano_x402_flow.py

  Investigator                     Trace Agent (seller, no key)          Facilitator (CF, Preprod)      Cardano L1
  ------------                     ----------------------------          -------------------------      ----------
  GET /api/trace/:addr  ---------> paymentMiddleware: no header
                        <--------- 402  PAYMENT-REQUIRED (b64 JSON)
                                   x402Version 2 · exact · cardano:preprod
                                   amount 1000000 lovelace · payTo addr_test1...
  policy(amount, classification)
    BEHAVIOR -> refuse · >1 tADA non-CONFIRMED -> human · >10 tADA -> human
  Koios: payer UTxOs
  build tx: in = nonce UTxO, out = payTo amount + change, fee, ttl
  sign (CIP-1852 key from MNEMONIC)
  GET + PAYMENT-SIGNATURE  ------> decode payload -------------------> /verify
                                                                        decode CBOR, networkId, witnesses,
                                                                        nonce in inputs, ttl window,
                                                                        inputs unspent (payer = nonce owner),
                                                                        fee, value conserved, min UTxO,
                                                                        recipient, asset, amount
                                   isValid? no -> 402 + reason
                                   handler: trace(addr)
                                     404 (unknown) -> return, no settle, nothing spent
                                   200 -> /settle ---------------------> claim txHash (dedup store)
                                                                        submit ------------------------> mempool, block
                                                                        await l1Confirmations <-------- confirmed
                                   success? no -> 402 (settlement_pending: check chain before retrying)
                        <--------- 200 trace JSON + PAYMENT-RESPONSE {success, transaction, network, payer}
  evidence: payment tx, resultHash, LINKED only
"""

import base64
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

LOVELACE = 1_000_000
NETWORK = "cardano:preprod"
NETWORK_ID = {"cardano:preprod": 0, "cardano:mainnet": 1}
MIN_UTXO = 969_750
MIN_FEE = 155_381
MAX_TIMEOUT_S = 300
SLOT_S = 1
INDEX = json.loads((Path(__file__).resolve().parents[2] / "services/trace-market/data/trace_index.json").read_text())

b64 = lambda o: base64.b64encode(json.dumps(o, sort_keys=True).encode()).decode()  # noqa: E731
unb64 = lambda s: json.loads(base64.b64decode(s))  # noqa: E731


# ---- Cardano L1 (eUTxO): an output can be spent once ----

@dataclass
class Ledger:
    utxo: dict = field(default_factory=dict)  # "txhash#ix" -> (address, lovelace)
    slot: int = 1_000
    confirmations_per_submit: int = 1

    def balance(self, addr):
        return sum(v for a, v in self.utxo.values() if a == addr)

    def submit(self, tx):
        if any(i not in self.utxo for i in tx["inputs"]):
            return False
        for i in tx["inputs"]:
            del self.utxo[i]
        h = tx_hash(tx)
        for ix, (addr, amt) in enumerate(tx["outputs"]):
            self.utxo[f"{h}#{ix}"] = (addr, amt)
        return True


def tx_hash(tx):
    body = {k: tx[k] for k in ("inputs", "outputs", "fee", "ttl", "network_id")}
    return hashlib.blake2b(json.dumps(body, sort_keys=True).encode(), digest_size=32).hexdigest()


# ---- Trace Agent data: trace.ts ----

def trace(address, max_depth=2, max_linked=20):
    a = address.lower()
    case_id = next((k for k, c in INDEX["cases"].items() if a in c["nodes"]), None)
    if case_id is None:
        return None
    nodes = INDEX["cases"][case_id]["nodes"]
    children = {}
    for x, n in nodes.items():
        if n["from"]:
            children.setdefault(n["from"], []).append(x)
    linked, frontier = [], [a]
    for depth in range(1, max_depth + 1):
        nxt = sorted((x for p in frontier for x in children.get(p, [])), key=lambda x: (-nodes[x]["tainted"], x))
        linked += [{"address": x, "relation": "RECEIVED_TAINTED_FROM", "from": nodes[x]["from"], "depth": depth,
                    "confidence": "LINKED", "taintPct": nodes[x]["taintPct"], "evidenceTx": nodes[x]["evidenceTx"]} for x in nxt]
        frontier = nxt
    out = {"traceCase": case_id, "seed": a, "linked": linked[:max_linked], "totalLinked": len(linked)}
    out["resultHash"] = "0x" + hashlib.sha256(json.dumps(out["linked"]).encode()).hexdigest()
    return out


# ---- Facilitator: exact/facilitator verify + settle ----

@dataclass
class Facilitator:
    ledger: Ledger
    settled: dict = field(default_factory=dict)
    l1_confirmations: int = 1

    def verify(self, payload, req):
        tx, nonce = payload["transaction"], payload["nonce"]
        if tx.get("network_id") != NETWORK_ID[req["network"]]:
            return False, "invalid_exact_cardano_payload_network_id_mismatch"
        if not tx.get("witnesses"):
            return False, "invalid_exact_cardano_payload_unsigned"
        owners = {self.ledger.utxo[i][0] for i in tx["inputs"] if i in self.ledger.utxo}
        if not owners <= set(tx["witnesses"]):
            return False, "invalid_exact_cardano_payload_invalid_signature"
        if nonce not in tx["inputs"]:
            return False, "invalid_exact_cardano_payload_nonce_not_in_inputs"
        if tx["ttl"] <= self.ledger.slot:
            return False, "invalid_exact_cardano_payload_ttl_expired"
        if tx["ttl"] > self.ledger.slot + MAX_TIMEOUT_S // SLOT_S:
            return False, "invalid_exact_cardano_payload_ttl_too_far"
        if nonce not in self.ledger.utxo:
            return False, "invalid_exact_cardano_payload_nonce_not_on_chain"
        if any(i not in self.ledger.utxo for i in tx["inputs"]):
            return False, "invalid_exact_cardano_payload_input_not_available"
        if tx["fee"] < MIN_FEE:
            return False, "invalid_exact_cardano_payload_fee_below_minimum"
        if sum(self.ledger.utxo[i][1] for i in tx["inputs"]) != sum(v for _, v in tx["outputs"]) + tx["fee"]:
            return False, "invalid_exact_cardano_payload_value_not_conserved"
        if any(v < MIN_UTXO for _, v in tx["outputs"]):
            return False, "invalid_exact_cardano_payload_min_utxo_insufficient"
        paid = sum(v for a, v in tx["outputs"] if a == req["payTo"])
        if paid == 0:
            return False, "invalid_exact_cardano_payload_recipient_mismatch"
        if req["asset"] != "lovelace":
            return False, "invalid_exact_cardano_payload_asset_mismatch"
        if paid < int(req["amount"]):
            return False, "invalid_exact_cardano_payload_amount_insufficient"
        return True, self.ledger.utxo[nonce][0]

    def settle(self, payload, req):
        tx = payload["transaction"]
        h = tx_hash(tx)
        if h in self.settled:
            return {"success": False, "errorReason": "duplicate_settlement", "transaction": h}
        self.settled[h] = "submitted"
        payer = self.ledger.utxo[payload["nonce"]][0]
        if not self.ledger.submit(tx):
            return {"success": False, "errorReason": "settlement_definitively_rejected", "transaction": h}
        if self.ledger.confirmations_per_submit < self.l1_confirmations:
            return {"success": False, "errorReason": "settlement_pending", "transaction": h}
        self.settled[h] = "confirmed"
        return {"success": True, "transaction": h, "network": req["network"], "payer": payer}


# ---- Trace Agent: server.ts (paymentMiddleware on GET /api/trace/:address) ----

@dataclass
class TraceAgent:
    facilitator: Facilitator
    pay_to: str = "addr_test1_trace_agent"
    price_lovelace: int = 1 * LOVELACE

    def requirements(self):
        return {"scheme": "exact", "network": NETWORK, "amount": str(self.price_lovelace), "asset": "lovelace",
                "payTo": self.pay_to, "maxTimeoutSeconds": MAX_TIMEOUT_S, "extra": {"areFeesSponsored": False}}

    def get(self, address, headers):
        req = self.requirements()
        required = {"PAYMENT-REQUIRED": b64({"x402Version": 2, "resource": {"url": f"/api/trace/{address}"}, "accepts": [req]})}
        if "PAYMENT-SIGNATURE" not in headers:
            return 402, None, required
        payload = unb64(headers["PAYMENT-SIGNATURE"])
        ok, reason = self.facilitator.verify(payload, req)
        if not ok:
            return 402, {"error": reason}, required
        body = trace(address)
        if body is None:
            return 404, {"error": "address not in any traced case"}, {}
        receipt = self.facilitator.settle(payload, req)
        if not receipt["success"]:
            return 402, {"error": receipt["errorReason"]}, required
        return 200, body, {"PAYMENT-RESPONSE": b64(receipt)}


# ---- Investigator: policy.ts + investigator.ts (@x402/fetch wrapFetchWithPayment) ----

def decide(amount, classification):
    if classification == "BEHAVIOR":
        return "refuse"
    if amount <= 1 * LOVELACE:
        return "auto"
    if amount <= 10 * LOVELACE and classification == "CONFIRMED":
        return "auto"
    return "human"


@dataclass
class Investigator:
    ledger: Ledger
    address: str = "addr_test1_investigator"
    max_per_payment: int = 10 * LOVELACE

    def build_and_sign(self, req, pay_to=None, amount=None, network=None, ttl=None):
        amount = int(req["amount"]) if amount is None else amount
        if amount > self.max_per_payment:
            raise PermissionError("spend control: above maxAmountPerPayment")
        nonce, (_, value) = next((r, u) for r, u in sorted(self.ledger.utxo.items()) if u[0] == self.address)
        fee = 170_000
        tx = {"inputs": [nonce], "outputs": [(pay_to or req["payTo"], amount), (self.address, value - amount - fee)],
              "fee": fee, "ttl": self.ledger.slot + 120 if ttl is None else ttl,
              "network_id": NETWORK_ID[network or req["network"]], "witnesses": [self.address]}
        return {"x402Version": 2, "accepted": req, "payload": {"transaction": tx, "nonce": nonce}}

    def buy_trace(self, agent, case_classification, address, tamper=None):
        status, _, headers = agent.get(address, {})
        if status != 402:
            return {"status": "UNEXPECTED", "http": status}
        req = unb64(headers["PAYMENT-REQUIRED"])["accepts"][0]
        decision = decide(int(req["amount"]), case_classification)
        if decision != "auto":
            return {"status": "HUMAN_APPROVAL_REQUIRED" if decision == "human" else "REFUSED", "http": 402}
        signed = self.build_and_sign(req, **(tamper or {}))
        status, body, headers = agent.get(address, {"PAYMENT-SIGNATURE": b64(signed["payload"])})
        if status != 200:
            return {"status": "NOT_DELIVERED", "http": status, "reason": (body or {}).get("error"), "signed": signed}
        receipt = unb64(headers["PAYMENT-RESPONSE"])
        return {"status": "DELIVERED", "http": 200, "paymentTx": receipt["transaction"], "payer": receipt["payer"],
                "traceCase": body["traceCase"], "totalLinked": body["totalLinked"], "resultHash": body["resultHash"],
                "classification": "LINKED", "signed": signed}


# ---- scenarios ----

def world(price=1 * LOVELACE, confirmations=1):
    ledger = Ledger(utxo={"a0" * 32 + "#0": ("addr_test1_investigator", 50 * LOVELACE)})
    ledger.confirmations_per_submit = confirmations
    agent = TraceAgent(Facilitator(ledger), price_lovelace=price)
    return ledger, agent, Investigator(ledger)


def run():
    seed = INDEX["cases"]["bybit-2025-02"]["seeds"][0]
    rows = []

    ledger, agent, inv = world()
    ok = inv.buy_trace(agent, "CONFIRMED", seed)
    rows.append(("CONFIRMED case, 1 tADA", ok["status"], f"{ok['totalLinked']} linked, tx {ok['paymentTx'][:12]}..., seller +{ledger.balance(agent.pay_to) / LOVELACE} tADA"))
    assert ok["status"] == "DELIVERED" and ledger.balance(agent.pay_to) == LOVELACE

    replay = agent.get(seed, {"PAYMENT-SIGNATURE": b64(ok["signed"]["payload"])})
    rows.append(("same PAYMENT-SIGNATURE replayed", replay[0], replay[1]["error"]))
    assert replay[0] == 402 and ledger.balance(agent.pay_to) == LOVELACE

    for name, classification, price, tamper, want in [
        ("LINKED case, 5 tADA", "LINKED", 5 * LOVELACE, None, "HUMAN_APPROVAL_REQUIRED"),
        ("BEHAVIOR case", "BEHAVIOR", 1 * LOVELACE, None, "REFUSED"),
        ("underpay 0.98 of 1 tADA", "CONFIRMED", 1 * LOVELACE, {"amount": 980_000}, "invalid_exact_cardano_payload_amount_insufficient"),
        ("pay the wrong address", "CONFIRMED", 1 * LOVELACE, {"pay_to": "addr_test1_someone_else"}, "invalid_exact_cardano_payload_recipient_mismatch"),
        ("mainnet network id", "CONFIRMED", 1 * LOVELACE, {"network": "cardano:mainnet"}, "invalid_exact_cardano_payload_network_id_mismatch"),
        ("expired ttl", "CONFIRMED", 1 * LOVELACE, {"ttl": 900}, "invalid_exact_cardano_payload_ttl_expired"),
    ]:
        ledger, agent, inv = world(price)
        r = inv.buy_trace(agent, classification, seed, tamper)
        got = r.get("reason") or r["status"]
        rows.append((name, r["http"], got))
        assert got == want and ledger.balance(agent.pay_to) == 0, (name, got)

    ledger, agent, inv = world()
    r = inv.buy_trace(agent, "CONFIRMED", "0x0000000000000000000000000000000000000001")
    rows.append(("unknown address", r["http"], f"no settle, payer still {ledger.balance(inv.address) / LOVELACE} tADA"))
    assert r["http"] == 404 and ledger.balance(inv.address) == 50 * LOVELACE

    ledger, agent, inv = world(price=11 * LOVELACE)
    status, _, headers = agent.get(seed, {})
    try:
        inv.build_and_sign(unb64(headers["PAYMENT-REQUIRED"])["accepts"][0])
    except PermissionError as e:
        rows.append(("11 tADA, SDK spend control", 402, str(e)))

    ledger, agent, inv = world(confirmations=0)
    agent.facilitator.l1_confirmations = 1
    r = inv.buy_trace(agent, "CONFIRMED", seed)
    rows.append(("block not confirmed in time", r["http"], f"{r['reason']} (paid on chain: {ledger.balance(agent.pay_to) / LOVELACE} tADA)"))
    assert r["reason"] == "settlement_pending"

    for name, http, detail in rows:
        print(f"{name:34s} {str(http):26s} {detail}")


if __name__ == "__main__":
    run()
