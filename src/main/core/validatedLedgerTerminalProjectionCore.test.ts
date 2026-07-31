import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldPersistTransportFailure } from './agentTransportFailureWriterCore'
import {
  shouldPersistValidatedLedgerTerminal,
  validatedLedgerTerminalDedupeKey,
} from './validatedLedgerTerminalProjectionCore'
import { ledgerTerminalToFailureRow } from './validatedLedgerTerminalCore'

test('shouldPersistValidatedLedgerTerminal always persists max-steps-cap', () => {
  const row = ledgerTerminalToFailureRow({
    ts: 1_000,
    originalRequestId: 'orig-max',
    isMaxSteps: true,
    reason: 'Reached maximum number of steps',
  })
  assert.equal(shouldPersistValidatedLedgerTerminal(row), true)
  assert.equal(shouldPersistTransportFailure(row), true)
})

test('validatedLedgerTerminalDedupeKey uses originalRequestId bucket', () => {
  const row = ledgerTerminalToFailureRow({
    ts: 12_000,
    originalRequestId: 'orig-1',
    requestId: 'resume-1',
    isMaxSteps: false,
    streamPrimarySub: 'server-eof',
    durationMs: 2_000_000,
  })
  assert.equal(validatedLedgerTerminalDedupeKey(row), 'ledger|orig-1|2')
})
