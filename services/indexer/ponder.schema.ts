// ponder_quorum tables (20_data.md 3.2b).
import { onchainTable, primaryKey } from 'ponder'

export const chainEvents = onchainTable(
  'chain_events',
  (t) => ({
    chainId: t.integer().notNull(),
    blockNumber: t.bigint().notNull(),
    blockTime: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    logIndex: t.integer().notNull(),
    contract: t.hex().notNull(),
    contractName: t.text().notNull(),
    event: t.text().notNull(),
    caseId: t.hex(),
    args: t.json().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.txHash, t.logIndex] }) }),
)

export const cases = onchainTable('cases', (t) => ({
  caseId: t.hex().primaryKey(),
  orgId: t.hex(),
  kind: t.text().notNull(), // withdrawal | trap | patrol
  requestId: t.hex(),
  txHash: t.hex(),
  decision: t.integer(),
  publicReason: t.integer(),
  sealedReason: t.hex(),
  firstSeen: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}))
