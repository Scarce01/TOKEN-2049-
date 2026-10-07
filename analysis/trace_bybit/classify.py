"""Breakpoint classification. Every label carries its source; nothing is guessed from memory.

Order: curated labels.json (Etherscan name tags checked by hand) -> contract (type from the verified
contract name on Etherscan) -> very high activity EOA (truncated fetch) -> None (keep tracing).
"""

import json
from pathlib import Path

import etherscan

HERE = Path(__file__).parent
KEYWORDS = [  # contract-name keyword -> type
    ("router", "dex/bridge router"),
    ("bridge", "bridge"),
    ("swap", "dex"),
    ("pool", "dex/pool"),
    ("exchange", "exchange"),
    ("vault", "vault"),
    ("mixer", "mixer"),
    ("tornado", "mixer"),
    ("proxy", "proxy contract"),
    ("safe", "multisig"),
    ("gnosis", "multisig"),
]


def load_labels():
    f = HERE / "labels.json"
    d = json.loads(f.read_text()) if f.exists() else {}
    return {k.lower(): v for k, v in d.items() if not k.startswith("_")}


def make_classifier(cfg, truncated_addrs, services=None):
    services = services or {}
    labels = load_labels()

    def classify(addr):
        a = addr.lower()
        if a in labels:
            return {"type": labels[a]["type"], "source": labels[a]["source"]}
        if a in services:
            return {"type": "service (many senders)", "source": f"{services[a]} distinct senders in window (heuristic)"}
        if a in truncated_addrs:
            return {"type": "high-degree service", "source": "fetch truncated at max_rows_per_address"}
        if etherscan.is_contract(a, cfg["end_block"]):
            name = etherscan.contract_name(a)
            low = name.lower()
            for kw, typ in KEYWORDS:
                if kw in low:
                    return {"type": typ, "source": f"etherscan getsourcecode ContractName={name}"}
            return {"type": "contract (unlabeled)" if not name else f"contract ({name})", "source": "eth_getCode at end block"}
        return None

    return classify
