#!/usr/bin/env bash
# Solana toolchain (Anchor 1.0.2 + Agave) in Docker, so Windows needs no Rust or Solana install.
#   bash solana/docker.sh build       anchor build, sync the program id, keep a copy of the program keypair in secrets/
#   bash solana/docker.sh validator   local validator with the program loaded (RPC 8899, websocket 8900) for bun test
#   bash solana/docker.sh deploy      deploy to devnet, paid by secrets/solana/deployer.json
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../secrets/solana
HERE=$(pwd -W 2>/dev/null || pwd)
KEYS=$(cd ../secrets/solana && (pwd -W 2>/dev/null || pwd))
IMG=solanafoundation/anchor:v1.0.2
export MSYS_NO_PATHCONV=1
run() { docker run --rm -v "$HERE:/work" -v "$KEYS:/keys" -v qubee-cargo-registry:/root/.cargo/registry -w /work "$@"; }
case "${1:-}" in
  build) run "$IMG" bash -c 'anchor build && anchor keys sync && anchor build && cp -n target/deploy/qubee_guard-keypair.json /keys/ || true' ;;
  validator) run -p 8899:8899 -p 8900:8900 "$IMG" bash -c 'solana-test-validator --reset --ledger /tmp/ledger --bpf-program "$(solana-keygen pubkey target/deploy/qubee_guard-keypair.json)" target/deploy/qubee_guard.so' ;;
  deploy) run "$IMG" anchor deploy --provider.cluster devnet --provider.wallet /keys/deployer.json ;;
  *) run "$IMG" "$@" ;;
esac
