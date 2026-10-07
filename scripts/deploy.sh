#!/usr/bin/env bash
# Usage: scripts/deploy.sh <anvil|base-sepolia|base-sepolia-fork>. Reads contracts/.env.<name>, else contracts/.env.
set -euo pipefail
NAME="${1:-base-sepolia}"
cd "$(dirname "$0")/../contracts"
# contracts/.env.<name> (e.g. .env.anvil) wins over contracts/.env, so local and testnet keys never mix.
ENVF=".env.$NAME"; [ -f "$ENVF" ] || ENVF=".env"
set -a; [ -f "$ENVF" ] && . "./$ENVF"; set +a
export DEPLOY_NAME="$NAME"
RPC="${BASE_SEPOLIA_RPC:-https://sepolia.base.org}"
[ "$NAME" = "anvil" ] && RPC="http://127.0.0.1:8545"
# Any *-fork name (e.g. base-sepolia-fork) is the local anvil fork. Set after sourcing the env file, so a public
# BASE_SEPOLIA_RPC there can never turn a fork deploy into a public broadcast (audit 2026-10-07).
case "$NAME" in *-fork) RPC="http://127.0.0.1:8545" ;; esac
VERIFY=()
[ "$NAME" = "base-sepolia" ] && [ -n "${BASESCAN_API_KEY:-}" ] && VERIFY=(--verify --chain 84532)
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" --broadcast "${VERIFY[@]}"
cd ..
bun packages/shared/scripts/gen-abi.ts
DEPLOY_NAME="$NAME" bun services/decoy-admin/src/cli.ts configs || true
echo "deployed: deployments/$NAME.json"
