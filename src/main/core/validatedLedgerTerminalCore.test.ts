import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentTransportFailureRow } from './connectPartitionDetectCore'
import {
  isMaxStepsLedgerTerminal,
  mergeTerminalsForMaxStepsRate,
  parseValidatedLedgerTerminalLine,
} from './validatedLedgerTerminalCore'

const maxStepsLedgerLine = JSON.stringify({
  envelope: {
    eventKind: 'stream_terminated',
    occurredAtMs: 1_785_350_772_485,
    requestId: 'a48a69a2-c162-48c2-82da-9199cc711081',
    originalRequestId: '64cea77c-b041-4273-b3e5-f1325788fd8a',
    composerId: 'ab194449-a760-40d1-af95-1b166096ece1',
    payload: {
      terminalKind: 'agent_error_disconnect',
      terminalMs: 1_785_350_772_485,
      reason: '[internal] Reached maximum number of steps before turn ended (possible looping?)',
      streamPrimarySub: 'transport',
      willRetry: false,
      lastSseCase: 'stepCompleted',
    },
  },
})

test('parseValidatedLedgerTerminalLine extracts max-steps stream_terminated', () => {
  const row = parseValidatedLedgerTerminalLine(maxStepsLedgerLine)
  assert.ok(row)
  assert.equal(row.originalRequestId, '64cea77c-b041-4273-b3e5-f1325788fd8a')
  assert.equal(isMaxStepsLedgerTerminal(row), true)
})

test('mergeTerminalsForMaxStepsRate prefers ledger max-steps over jsonl server-eof', () => {
  const jsonlRows: AgentTransportFailureRow[] = [
    {
      ts: 1_785_350_800_000,
      originalRequestId: '64cea77c-b041-4273-b3e5-f1325788fd8a',
      reasonSub: 'server-eof',
      errMsg: 'Stream ended',
    },
  ]
  const ledgerRow = parseValidatedLedgerTerminalLine(maxStepsLedgerLine)
  assert.ok(ledgerRow)
  const merged = mergeTerminalsForMaxStepsRate(jsonlRows, [ledgerRow])
  const terminal = merged.get('64cea77c-b041-4273-b3e5-f1325788fd8a')
  assert.ok(terminal)
  assert.equal(terminal.reasonSub, 'max-steps-cap')
})
