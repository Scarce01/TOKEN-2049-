"""Live decoy inventory (docs/48_decoy_generation.md section 7). Defender-side, binds 127.0.0.1 only.

Runs one epoch every --tick seconds (demo clock: one 7-day epoch per tick) and replays each epoch's events in
wall time, so the UI sees decoys generated (pool, offline), promoted (online), retired and burned as they happen.
Everything served is tags, counts and statistics: no userId, ident or features (CLAUDE.md rule 2).
Nothing goes on chain and the example decoy is untouched: this is the off-chain plan only.

GET  /health
GET  /decoygen/inventory   online (committed) and offline (pool waiting, retired, burned) plus the last epoch
GET  /decoygen/stream      server-sent events: epoch, generate, promote, retire, burn, gate-fail
GET  /decoygen/feed        every epoch so far
POST /decoygen/step        run the next epoch now
POST /decoygen/burn        {"tag"}: an online decoy was touched; out at once, an epoch runs now to replace it
POST /decoygen/retire      {"tag"}: operator pulls an online or pool decoy; an epoch runs now
POST /decoygen/pause, /decoygen/resume

Usage: python analysis/decoygen/serve.py [--org a] [--tick 30] [--synthetic 1000] [--port 8791] [--fresh]
"""

import argparse
import json
import os
import re
import shutil
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
from lifecycle import LIFE  # noqa: E402
from run import ROOT, context, read, step  # noqa: E402

TAG = re.compile(r"^0x[0-9a-f]{16}$")
ORIGINS = {"http://127.0.0.1:8443", "http://localhost:8443"}


class Live:
    def __init__(self, ctx: dict, name: str, tick: float, target: int):
        self.ctx, self.name, self.tick, self.target = ctx, name, tick, target
        self.cond = threading.Condition()
        self.log, self.pending, self.view = [], [], {}
        self.paused, self.stepping, self.force = False, False, False
        self.burned, self.manual = set(), set()
        out = os.path.join(ROOT, "secrets", "decoygen", name)
        st = read(os.path.join(out, "state.json"), {"epoch": 0, "active": [], "pool": [], "retired": []})
        self.epoch = st["epoch"]
        for r in st["pool"]:
            self.view[r["tag"]] = self._rec(r, "pool")
        for r in st["active"]:
            self.view[r["tag"]] = self._rec(r, "online")
        for r in st["retired"]:
            self.view[r["tag"]] = {"tag": r["tag"], "status": "burned" if r["reason"] == "burned" else "retired", "reason": r["reason"], "retiredEpoch": r["epoch"]}
        feed = read(os.path.join(out, "feed.json"), {"epochs": []})
        self.summary = self._summary(feed["epochs"][-1]) if feed["epochs"] else None
        self.next_at = time.time() + (1 if not self.epoch else tick)

    def _rec(self, r: dict, status: str) -> dict:
        return {"tag": r["tag"], "status": status, "born": r["born"], "matureAt": r["born"] + LIFE["ageEpochs"],
                "promoted": r.get("promoted") if status == "online" else None, "preAged": r.get("preAged") if status == "online" else None}

    @staticmethod
    def _summary(e: dict) -> dict:
        return {k: e[k] for k in ("epoch", "window", "rotateAt", "root", "leafCount", "funnel", "gate", "pFirst")}

    # ---- clock ----
    def run(self):
        while True:
            with self.cond:
                due = self.force or (not self.paused and time.time() >= self.next_at)
            if due:
                self._step()
            self._release(time.time())
            time.sleep(0.2)

    def _step(self):
        with self.cond:
            self.stepping, self.force = True, False
            burned, manual, self.burned, self.manual = self.burned, self.manual, set(), set()
        self._release(float("inf"))  # an early step first lands whatever the last epoch still had queued
        try:
            state, entry = step(self.ctx, self.name, self.epoch + 1, burned=burned, manual=manual, target=self.target, report=False)
        except Exception:
            traceback.print_exc()
            with self.cond:
                self.stepping, self.next_at = False, time.time() + self.tick
            return
        recs = {r["tag"]: r for r in state["active"] + state["pool"]}
        t0, (s, e) = time.time(), entry["window"]
        evs = [(t0, {"kind": "epoch", **self._summary(entry), "online": len(entry["active"]), "pool": len(entry["pool"])})]
        last, n = None, 0
        for ev in entry["events"]:  # sim time inside the epoch -> wall time inside this tick, same-time events staggered
            n = n + 1 if ev["t"] == last else 0
            last = ev["t"]
            evs.append((t0 + (ev["t"] - s) / (e - s) * self.tick * 0.9 + n * 0.12, {**ev, "epoch": entry["epoch"], "rec": recs.get(ev.get("tag"))}))
        with self.cond:
            self.epoch, self.stepping = entry["epoch"], False
            self.pending = sorted(self.pending + evs, key=lambda x: x[0])
            self.next_at = t0 + self.tick
        print(f"epoch {entry['epoch']}: gate {'pass' if entry['gate']['pass'] else 'FAIL'}, online {len(entry['active'])}, pool {len(entry['pool'])}, root {entry['root'][:10]}..", flush=True)

    def _release(self, now: float):
        with self.cond:
            while self.pending and self.pending[0][0] <= now:
                _, ev = self.pending.pop(0)
                rec = ev.pop("rec", None)
                k, tag = ev["kind"], ev.get("tag")
                if k == "epoch":
                    self.summary = {x: ev[x] for x in ("epoch", "window", "rotateAt", "root", "leafCount", "funnel", "gate", "pFirst")}
                elif k == "generate" and rec:
                    self.view[tag] = self._rec(rec, "pool") | {"segments": ev.get("segments")}
                elif k == "promote" and rec:
                    self.view[tag] = self._rec(rec, "online") | {"segments": ev.get("segments")}
                elif k in ("retire", "burn") and tag:
                    self.view[tag] = {"tag": tag, "status": "burned" if k == "burn" else "retired", "reason": ev.get("reason"), "retiredEpoch": ev["epoch"]}
                self.log.append({"seq": len(self.log) + 1, "wall": int(time.time() * 1000), **ev})
                self.cond.notify_all()

    # ---- read side ----
    def inventory(self) -> dict:
        with self.cond:
            v = list(self.view.values())
            gone = sorted((r for r in v if r["status"] in ("retired", "burned")), key=lambda r: -r["retiredEpoch"])
            return {
                "org": self.ctx["org"], "epoch": self.epoch, "live": not self.paused, "stepping": self.stepping,
                "tick": self.tick, "nextStepAt": int(self.next_at * 1000), "summary": self.summary,
                "online": sorted((r for r in v if r["status"] == "online"), key=lambda r: r["tag"]),
                "offline": {"pool": sorted((r for r in v if r["status"] == "pool"), key=lambda r: (r["born"], r["tag"])), "retired": gone[:50]},
                "counts": {s: sum(r["status"] == s for r in v) for s in ("online", "pool", "retired", "burned")},
                "source": "assumed",
            }

    def act(self, what: str, tag: str | None) -> tuple[int, dict]:
        with self.cond:
            if what in ("pause", "resume"):
                self.paused = what == "pause"
                if not self.paused:
                    self.next_at = min(self.next_at, time.time() + self.tick)
                return 200, {"live": not self.paused}
            if what == "step":
                self.force = True
                return 202, {"queued": "step"}
            if not tag or not TAG.match(tag):
                return 400, {"error": "tag must be 0x + 16 hex"}
            r = self.view.get(tag)
            if what == "burn" and (not r or r["status"] != "online"):
                return 409, {"error": "only an online decoy can be burned"}
            if what == "retire" and (not r or r["status"] not in ("online", "pool")):
                return 409, {"error": "only an online or pool decoy can be retired"}
            (self.burned if what == "burn" else self.manual).add(tag)
            self.force = True
            return 202, {"queued": what, "tag": tag}


def handler(live: Live, feed_path: str):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):  # request lines carry tags at most; keep the console quiet anyway
            pass

        def _cors(self):
            o = self.headers.get("Origin")
            if o in ORIGINS:
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Vary", "Origin")

        def _json(self, code: int, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/health":
                return self._json(200, {"ok": True, "org": live.ctx["org"], "epoch": live.epoch})
            if path == "/decoygen/inventory":
                return self._json(200, live.inventory())
            if path == "/decoygen/feed":
                return self._json(200, read(feed_path, {"org": live.ctx["org"], "epochs": []}))
            if path == "/decoygen/stream":
                return self._stream()
            self._json(404, {"error": "not found"})

        def do_POST(self):
            m = re.fullmatch(r"/decoygen/(step|burn|retire|pause|resume)", self.path.split("?")[0])
            if not m:
                return self._json(404, {"error": "not found"})
            n = min(int(self.headers.get("Content-Length") or 0), 4096)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self._json(400, {"error": "bad json"})
            tag = body.get("tag") if isinstance(body, dict) else None
            self._json(*live.act(m.group(1), tag.lower() if isinstance(tag, str) else None))

        def _stream(self):
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            last = self.headers.get("Last-Event-ID")
            with live.cond:
                i = int(last) if last and last.isdigit() else len(live.log)
            try:
                self.wfile.write(b"retry: 2000\n\n")
                while True:
                    with live.cond:
                        if len(live.log) <= i:
                            live.cond.wait(15)
                        batch = live.log[i:]
                    if not batch:
                        self.wfile.write(b": keepalive\n\n")
                    for ev in batch:
                        self.wfile.write(f"id: {ev['seq']}\nevent: decoy\ndata: {json.dumps(ev)}\n\n".encode())
                    i += len(batch)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--org", default="a", choices=["a", "b"])
    ap.add_argument("--tick", type=float, default=30, help="wall seconds per 7-day epoch")
    ap.add_argument("--real", help="real accounts JSON (default datasets/out/accounts-<org>.json)")
    ap.add_argument("--synthetic", type=int, default=1000, help="N synthetic accounts (0 = use --real); 100 is too few for the gate")
    ap.add_argument("--target", type=int, default=LIFE["target"])
    ap.add_argument("--port", type=int, default=8791)
    ap.add_argument("--fresh", action="store_true", help="wipe this live run (secrets/decoygen/<org>-live) and start at epoch 1")
    a = ap.parse_args()
    name = f"{a.org}-live"
    out = os.path.join(ROOT, "secrets", "decoygen", name)
    if a.fresh and os.path.isdir(out):
        shutil.rmtree(out)
    live = Live(context(a.org, a.real, a.synthetic), name, a.tick, a.target)
    threading.Thread(target=live.run, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), handler(live, os.path.join(out, "feed.json")))
    srv.daemon_threads = True
    print(f"decoygen live: org {a.org}, epoch {live.epoch}, tick {a.tick}s, http://127.0.0.1:{a.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
