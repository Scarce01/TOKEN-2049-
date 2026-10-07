#!/usr/bin/env bash
# Fails if anything that must never be in git is tracked (CLAUDE.md rule 2 and "do not commit").
# DECOY_SCAN_LIST (optional, CI secret): comma-separated decoy addresses or tags; any hit in a tracked file fails.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0

bad=$(git ls-files | grep -E '(^|/)\.env($|\.)|^secrets/|\.local\.json$|(^|/)config\.[^/]*\.json$' \
  | grep -vE '\.env\.example$|^secrets/README\.md$|config\.example\.json$' || true)
if [ -n "$bad" ]; then
  echo "::error::Tracked files that must stay out of git:"; echo "$bad"; fail=1
fi

# Private keys: 0x + 64 hex on a line that names a key. Test vectors with well-known Anvil keys are allowed.
keys=$(git grep -nIiE '(private|priv|secret|pk)[_a-z]*["'"'"' ]*[:=][^0-9a-fx]*0x[0-9a-f]{64}' -- . ':!pnpm-lock.yaml' \
  | grep -viE 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80|59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d|5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' || true)
if [ -n "$keys" ]; then
  echo "::error::Possible private key committed:"; echo "$keys"; fail=1
fi

if [ -n "${DECOY_SCAN_LIST:-}" ]; then
  IFS=',' read -ra items <<< "$DECOY_SCAN_LIST"
  for it in "${items[@]}"; do
    it=$(echo "$it" | tr -d '[:space:]')
    [ -z "$it" ] && continue
    if git grep -qIiF "$it" -- .; then
      # Print only file names, never the decoy itself.
      echo "::error::A decoy identifier appears in tracked files:"; git grep -lIiF "$it" -- .; fail=1
    fi
  done
fi

[ "$fail" = 0 ] && echo "hygiene ok"
exit "$fail"
