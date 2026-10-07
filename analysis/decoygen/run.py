"""Plan one decoy epoch (docs/48_decoy_generation.md). Defender-side, local only.

Writes (all gitignored except the stats report):
  secrets/decoygen/<name>/state.json        pool, active set, retired tags, used ids
  secrets/decoygen/<name>/epoch-<e>.json    full plan: identities, features, commit paths, life traces
  secrets/decoygen/<name>/feed.json         tags, counts and events only, for the defender UI
  reports/decoygen/<org>-epoch-<e>.json     statistics only, no tags, no counts (skipped with --no-report)

Never touches secrets/decoys.local.json, secrets/fork-demo.local.json, workflow configs or the chain:
promoting a plan into the exchange, the traps and DecoyCommit is a separate, reviewed step.

Usage: python analysis/decoygen/run.py --org a --epoch 1 [--real FILE | --synthetic 1000] [--burned 0xtag,..]
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lifecycle import LIFE, run_epoch  # noqa: E402
from model import synthetic_population  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def read(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)  # readers (the live server, the UI) never see a half-written file


def org_salt(org: str) -> bytes:
    v = os.environ.get(f"ORG_SALT_{org.upper()}")
    env = os.path.join(ROOT, "apps", "exchange-api", ".env.fork")  # the fork demo's exchange-api is org A
    if not v and org == "a" and os.path.exists(env):
        v = next((ln.split("=", 1)[1].strip() for ln in open(env, encoding="utf-8") if ln.startswith("ORG_SALT=")), None)
    if not v:
        raise SystemExit(f"ORG_SALT_{org.upper()} not set (userIdHash needs it)")
    return bytes.fromhex(v.removeprefix("0x"))


def context(org: str, real_path: str | None, synthetic: int) -> dict:
    """Everything an epoch needs that does not change between epochs."""
    k = bytes.fromhex(read(os.path.join(ROOT, "secrets", "quorum_k.local.json"))["k"].removeprefix("0x"))
    real = synthetic_population(synthetic, 2049, org) if synthetic else read(real_path or os.path.join(ROOT, "datasets", "out", f"accounts-{org}.json"))
    taken = {x["userId"] for x in real} | {x["userId"] for x in read(os.path.join(ROOT, "datasets", "out", f"all-accounts-{org}.json"), [])}
    chain_id = read(os.path.join(ROOT, "deployments", "base-sepolia-fork.json"), {"chainId": 84532})["chainId"]
    return {"org": org, "k": k, "real": real, "taken": taken, "chainId": chain_id, "salt": org_salt(org)}


def step(ctx: dict, name: str, epoch: int, burned=frozenset(), manual=frozenset(), target=LIFE["target"], report=True):
    out = os.path.join(ROOT, "secrets", "decoygen", name)
    state_path, feed_path = os.path.join(out, "state.json"), os.path.join(out, "feed.json")
    state, plan, entry, rep = run_epoch(
        read(state_path), ctx["real"], ctx["k"], ctx["org"], ctx["chainId"], epoch, ctx["salt"], ctx["taken"],
        burned=burned, manual=manual, life={**LIFE, "target": target},
    )
    write(os.path.join(out, f"epoch-{epoch}.json"), plan)
    write(state_path, state)
    feed = read(feed_path, {"org": ctx["org"], "epochs": []})
    feed["epochs"] = [e for e in feed["epochs"] if e["epoch"] != epoch] + [entry]
    write(feed_path, feed)
    if report:
        write(os.path.join(ROOT, "reports", "decoygen", f"{ctx['org']}-epoch-{epoch}.json"), rep)
    return state, entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--org", default="a", choices=["a", "b"])
    ap.add_argument("--epoch", type=int, required=True)
    ap.add_argument("--real", help="real accounts JSON (default datasets/out/accounts-<org>.json)")
    ap.add_argument("--synthetic", type=int, default=0, help="use N synthetic accounts instead (gen-accounts.ts distributions)")
    ap.add_argument("--burned", default="", help="comma-separated tags touched since the last epoch")
    ap.add_argument("--target", type=int, default=LIFE["target"])
    ap.add_argument("--no-report", action="store_true")
    a = ap.parse_args()
    ctx = context(a.org, a.real, a.synthetic)
    burned = {t.strip().lower() for t in a.burned.split(",") if t.strip()}
    _, entry = step(ctx, a.org, a.epoch, burned=burned, target=a.target, report=not a.no_report)
    kinds = {}
    for e in entry["events"]:
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    print(f"org {a.org} epoch {a.epoch}: gate {'pass' if entry['gate']['pass'] else 'FAIL'} (auc upper {entry['gate']['aucUpper'] or 0:.3f}), "
          f"online {len(entry['active'])}, pool {len(entry['pool'])}, events {kinds}; plan in secrets/decoygen/{a.org}/")


if __name__ == "__main__":
    main()
