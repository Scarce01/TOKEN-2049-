"""Build the private runtime bundle for the AWS fork container (infra/fork/start.py) from this machine.

Exports the running anvil fork's state (anvil_dumpState) and collects the gitignored files the stack needs.
The output .tmp/fork-bundle.tgz holds testnet keys and the decoy config: it goes to a private S3 object only,
never into git or an image. Usage (repo root, anvil running on 8545): python infra/fork/bundle.py
"""
import gzip
import io
import json
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.tmp' / 'fork-bundle.tgz'
FILES = [
    'deployments/base-sepolia-fork.json',
    'apps/exchange-api/.env.fork',
    'workflows/.env',
    'workflows/trap/config.staging.json',
    'workflows/cosign/config.staging.json',
    'workflows/patrol/config.staging.json',
    'secrets/fork-demo.local.json',
    'secrets/quorum_k.local.json',
    'secrets/base-sepolia-keys.local.json',
]


def main():
    req = urllib.request.Request('http://127.0.0.1:8545', json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'anvil_dumpState', 'params': []}).encode(), {'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = bytes.fromhex(json.load(r)['result'][2:])
    state = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
    json.loads(state)  # must be the JSON anvil --load-state reads
    OUT.parent.mkdir(exist_ok=True)
    with tarfile.open(OUT, 'w:gz') as tar:
        info = tarfile.TarInfo('.tmp/fork-state.json')
        info.size = len(state)
        info.mode = 0o600
        tar.addfile(info, io.BytesIO(state))
        for f in FILES:
            tar.add(ROOT / f, arcname=f)
    OUT.chmod(0o600)
    print(f'wrote {OUT.relative_to(ROOT)}: fork state {len(state) // 1024} KiB + {len(FILES)} files, {OUT.stat().st_size // 1024} KiB')


if __name__ == '__main__':
    main()
