import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ingestValidatedLedgerTerminals,
  readValidatedLedgerTerminalCache,
  resetValidatedLedgerIngestPathsForTests,
  setValidatedLedgerIngestPathsForTests,
} from './validatedLedgerTerminalIngest'

test('ingestValidatedLedgerTerminals incrementally caches stream_terminated rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sparkle-ledger-ingest-'))
  const ledgerPath = join(dir, 'validated-ledger.v1.jsonl')
  const cachePath = join(dir, 'terminals.jsonl')
  const checkpointPath = join(dir, 'checkpoint.json')

  const line1 = JSON.stringify({
    envelope: {
      eventKind: 'stream_terminated',
      occurredAtMs: 1000,
      originalRequestId: 'orig-1',
      requestId: 'req-1',
      payload: {
        terminalMs: 1000,
        terminalKind: 'agent_error_disconnect',
        streamPrimarySub: 'server-eof',
        willRetry: true,
      },
    },
  })
  writeFileSync(ledgerPath, `${line1}\n`, 'utf8')

  setValidatedLedgerIngestPathsForTests({ ledgerPath, cachePath, checkpointPath })
  try {
    const first = await ingestValidatedLedgerTerminals(2000)
    assert.equal(first.length, 1)
    assert.equal(first[0]?.originalRequestId, 'orig-1')

    const line2 = JSON.stringify({
      envelope: {
        eventKind: 'stream_activity',
        occurredAtMs: 2000,
        originalRequestId: 'orig-2',
        payload: { activityKind: 'tokenDelta' },
      },
    })
    const line3 = JSON.stringify({
      envelope: {
        eventKind: 'stream_terminated',
        occurredAtMs: 3000,
        originalRequestId: 'orig-2',
        requestId: 'req-2',
        payload: {
          terminalMs: 3000,
          reason: '[internal] Reached maximum number of steps before turn ended',
          streamPrimarySub: 'transport',
          willRetry: false,
          lastSseCase: 'stepCompleted',
        },
      },
    })
    writeFileSync(ledgerPath, `${line1}\n${line2}\n${line3}\n`, 'utf8')

    const second = await ingestValidatedLedgerTerminals(4000)
    assert.equal(second.length, 2)
    assert.equal(readValidatedLedgerTerminalCache().length, 2)
    assert.match(readFileSync(checkpointPath, 'utf8'), /byteOffset/)
  } finally {
    resetValidatedLedgerIngestPathsForTests()
  }
})
