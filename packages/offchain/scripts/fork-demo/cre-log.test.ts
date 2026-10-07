import { expect, test } from 'bun:test'
import { parseCre, reportTxs } from './cre-log'

// Shape of a real `cre workflow simulate patrol --trigger-index 0 --broadcast` run on the fork (CRE CLI 1.36).
const OUT = `✓ Workflow compiled
2026-10-07T10:56:31Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-10-07T10:56:31Z [USER LOG] ping org=0xae467687 lastPing=0x01 note=0x02
2026-10-07T10:56:32Z [USER LOG] patrol ping report ok tx=0x${'f1'.repeat(32)}
2026-10-07T10:56:32Z [USER LOG] ping org=0x300e99ae lastPing=0x01 note=0x02
2026-10-07T10:56:33Z [USER LOG] patrol ping report ok tx=0x${'f2'.repeat(32)}
✓ Workflow Simulation Result:
"ping 2"
2026-10-07T10:56:33Z [SIMULATION] Execution finished signal received`

test('USER LOG lines, result and report txs', () => {
  const r = parseCre(OUT)
  expect(r.result).toBe('ping 2')
  expect(r.logs).toHaveLength(4)
  expect(r.logs[0]).toBe('ping org=0xae467687 lastPing=0x01 note=0x02')
  expect(r.errors).toEqual([])
  expect(reportTxs(r.logs)).toEqual([`0x${'f1'.repeat(32)}`, `0x${'f2'.repeat(32)}`])
})

test('a failed writeReport is an error log, not a report', () => {
  const r = parseCre('2026-10-07T00:00:00Z [USER LOG] [error] quota writeReport failed tx=0x00 txStatus=2')
  expect(r.logs[0]).toStartWith('[error]')
  expect(reportTxs(r.logs)).toEqual([])
})
