"""Container entrypoint: the local demo stack, configured exactly as on a developer machine.

1. pull the private runtime bundle (fork state, deployment file, .env files, workflow configs, fork-demo state)
   from S3 and unpack it over /app; CRE CLI credentials come from Secrets Manager (same secret shape as
   saladbkp/quorum-2049 infra/runtime/bootstrap.py: mode api-key or session)
2. start anvil on the exported fork state, take the bridge's reset snapshot
3. start the exchange DB and seed the hot wallets from the fork-demo state (as setup.ts does)
4. build the UI against this fork's deployment, then exec apps/observatory/serve.ts on $PORT, which starts
   exchange-api, decoygen, the bridge and the indexer and proxies them on one origin
Env: BUNDLE_S3 (s3://bucket/key) or BUNDLE_FILE (local test), AWS_REGION, CRE_AUTH_SECRET_ARN, FORK_RPC (default https://sepolia.base.org).
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

APP = Path('/app')
RPC = 'http://127.0.0.1:8545'


def log(msg):
    print(f'[fork] {msg}', flush=True)


def rpc(method, params=None):
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params or []}).encode()
    req = urllib.request.Request(RPC, body, {'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as r:
        out = json.load(r)
    if 'error' in out:
        raise RuntimeError(f'{method}: {out["error"]}')
    return out['result']


def private(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(text)


def main():
    import boto3

    region = os.environ.get('AWS_REGION', 'ap-southeast-1')
    if os.environ.get('BUNDLE_FILE'):  # local test of the image: the bundle mounted from this machine
        blob = Path(os.environ['BUNDLE_FILE']).read_bytes()
    else:
        bucket, key = os.environ['BUNDLE_S3'].removeprefix('s3://').split('/', 1)
        log(f'runtime bundle s3://{bucket}/{key}')
        blob = boto3.client('s3', region_name=region).get_object(Bucket=bucket, Key=key)['Body'].read()
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as tar:
        for m in tar.getmembers():  # only plain files under /app, nothing absolute or escaping
            if not m.isfile() or m.name.startswith('/') or '..' in Path(m.name).parts:
                raise RuntimeError(f'unexpected bundle entry {m.name}')
        tar.extractall(APP, filter='data')

    if os.environ.get('CRE_AUTH_SECRET_ARN'):
        auth = json.loads(boto3.client('secretsmanager', region_name=region).get_secret_value(SecretId=os.environ['CRE_AUTH_SECRET_ARN'])['SecretString'])
        if auth.get('mode') == 'api-key':
            os.environ['CRE_API_KEY'] = auth['api_key']
        elif auth.get('mode') == 'session':
            private(Path.home() / '.cre' / 'cre.yaml', auth['credentials'])
            private(Path.home() / '.cre' / 'context.yaml', auth['context'])
        log(f'CRE auth: {auth.get("mode")}')

    state = APP / '.tmp' / 'fork-state.json'
    anvil = subprocess.Popen(['anvil', '--fork-url', os.environ.get('FORK_RPC', 'https://sepolia.base.org'),
                              '--load-state', str(state), '--gas-limit', '100000000', '--port', '8545', '--host', '127.0.0.1', '--silent'])
    for _ in range(120):
        try:
            log(f'anvil up at block {int(rpc("eth_blockNumber"), 16)}')
            break
        except OSError:
            time.sleep(1)
    else:
        raise RuntimeError('anvil did not start')
    # the bridge's Reset reverts to this snapshot (snapshots do not survive an anvil restart)
    private(APP / '.tmp' / 'fork-snapshot.json', json.dumps({'id': rpc('evm_snapshot')}))

    shutil.copy(APP / 'deployments' / 'base-sepolia-fork.json', APP / 'apps' / 'observatory' / 'src' / 'deployment.json')
    pg = subprocess.Popen(['bun', 'scripts/round3-pg.ts'], cwd=APP)
    subprocess.run(['bun', 'infra/fork/seed-exchange.ts'], cwd=APP, check=True)
    log('building the UI for this fork')
    subprocess.run(['pnpm', 'build'], cwd=APP / 'apps' / 'observatory', check=True)

    # serve.ts reuses the running anvil and exchange DB and starts everything else
    serve = subprocess.Popen(['bun', 'serve.ts'], cwd=APP / 'apps' / 'observatory')
    while True:
        for name, p in (('anvil', anvil), ('exchange-db', pg), ('serve', serve)):
            if p.poll() is not None:
                log(f'{name} exited ({p.returncode}); stopping so ECS restarts the task')
                for q in (serve, pg, anvil):
                    if q.poll() is None:
                        q.terminate()
                sys.exit(1)
        time.sleep(5)


if __name__ == '__main__':
    main()
