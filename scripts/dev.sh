#!/usr/bin/env bash
# Starts exchange-api, indexer (Ponder), trap-sync, keeper, notifier, user-app and console in parallel.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
run() { (cd "$ROOT/$1" && set -a && { [ -f .env ] && . ./.env; true; } && set +a && $2) 2>&1 | sed "s/^/[$1] /" & }
run apps/exchange-api "bun src/index.ts"
run services/indexer "npx ponder dev --schema ponder_quorum"
run services/trap-sync "bun src/index.ts"
run services/keeper "bun src/index.ts"
run services/notifier "bun src/index.ts"
run apps/user-app "npx next dev -p 3002"
run apps/console "npx next dev -p 3001"
wait
