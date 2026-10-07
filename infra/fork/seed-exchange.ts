#!/usr/bin/env bun
import { type DemoState, seedDb, statePath } from '../../packages/offchain/scripts/fork-demo/setup'
// Seeds exchange_a.hot_wallets from secrets/fork-demo.local.json, the same rows fork-demo setup.ts writes.
// Used by the container (infra/fork/start.py) on a fresh exchange DB; it never touches the chain.
import { readJson } from '../../packages/offchain/src/index'

for (let i = 0; i < 60; i++) {
  try {
    await seedDb(readJson<DemoState>(statePath))
    console.log('exchange hot wallets seeded')
    process.exit(0)
  } catch (e) {
    if (i === 59) throw e
    await Bun.sleep(1000) // the exchange DB is still starting
  }
}
