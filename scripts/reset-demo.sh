#!/usr/bin/env bash
# Restores a clean state after a demo (31_phase1.md 1.4). Keeps tokens, DepositVault, KeyRegistry,
# RequestBoard and ConfigTimelock (no reseeding); redeploys Receivers, vaults, cold, ThreatRegistry, Lens.
# Usage: scripts/reset-demo.sh <anvil|base-sepolia>
set -euo pipefail
NAME="${1:-base-sepolia}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
set -a; [ -f .env ] && . ./.env; set +a
export DEPLOY_NAME="$NAME"
RPC="${BASE_SEPOLIA_RPC:-https://sepolia.base.org}"
[ "$NAME" = "anvil" ] && RPC="http://127.0.0.1:8545"
START=$(date +%s)
forge script script/Deploy.s.sol:ResetDemo --rpc-url "$RPC" --broadcast
cd "$ROOT"
set -a; [ -f services/decoy-admin/.env ] && . services/decoy-admin/.env; set +a
export DEPLOY_NAME="$NAME"
bun datasets/src/seed-chain.ts --org a --fund-only
bun datasets/src/seed-chain.ts --org b --fund-only
bun services/decoy-admin/src/cli.ts configs
# Ponder: new contract addresses and start block. Drop its tables and reindex from resetBlock.
if [ -n "${PONDER_ADMIN_DB_URL:-}" ]; then
  psql "$PONDER_ADMIN_DB_URL" -c "drop schema if exists ponder_quorum cascade; create schema ponder_quorum; alter schema ponder_quorum owner to ponder_svc; grant usage on schema ponder_quorum to console_svc; alter default privileges for role ponder_svc in schema ponder_quorum grant select on tables to console_svc;"
fi
echo "reset-demo done in $(( $(date +%s) - START ))s. Restart indexer, trap-sync and sim-runner; mode A: redeploy the 3 workflows."
