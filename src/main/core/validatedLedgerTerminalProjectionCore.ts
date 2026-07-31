// [INPUT] ValidatedLedgerTerminalRow · agentTransportFailureWriterCore
// [OUTPUT] projectValidatedLedgerTerminalsToJsonl
// [POS] G8b — ledger stream_terminated → ~/.sparkle/agent-transport-failures.jsonl projection.

import type { AgentTransportFailureRow } from './agentTransportFailureWriterCore'
import {
  shouldPersistTransportFailure,
  rowDedupeKey,
} from './agentTransportFailureWriterCore'
import { isMaxStepsTerminalRow } from './maxStepsRateObserverCore'
import {
  ledgerTerminalToFailureRow,
  type ValidatedLedgerTerminalRow,
} from './validatedLedgerTerminalCore'
import { ingestValidatedLedgerTerminals } from './validatedLedgerTerminalIngest'

export function shouldPersistValidatedLedgerTerminal(row: AgentTransportFailureRow): boolean {
  if (isMaxStepsTerminalRow(row)) {
    return true
  }
  return shouldPersistTransportFailure(row)
}

export function validatedLedgerTerminalDedupeKey(row: AgentTransportFailureRow): string {
  const originalRequestId = String(row.originalRequestId ?? row.requestId ?? '').trim()
  if (originalRequestId) {
    const bucket = Math.floor(row.ts / 5_000)
    return `ledger|${originalRequestId}|${bucket}`
  }
  return rowDedupeKey(row)
}

export async function projectValidatedLedgerTerminalsToJsonl(input: {
  sinceMs: number
  seen: Set<string>
  appendRow: (row: AgentTransportFailureRow) => Promise<void>
  nowMs?: number
}): Promise<number> {
  const ledgerRows = await ingestValidatedLedgerTerminals(input.nowMs ?? Date.now())
  let written = 0
  for (const ledgerRow of ledgerRows) {
    if (ledgerRow.ts < input.sinceMs) {
      continue
    }
    const failureRow = ledgerTerminalToFailureRow(ledgerRow)
    if (!shouldPersistValidatedLedgerTerminal(failureRow)) {
      continue
    }
    const key = validatedLedgerTerminalDedupeKey(failureRow)
    if (input.seen.has(key)) {
      continue
    }
    input.seen.add(key)
    await input.appendRow(failureRow)
    written += 1
  }
  return written
}

export function ledgerTerminalRowsForTests(
  rows: readonly ValidatedLedgerTerminalRow[],
): ValidatedLedgerTerminalRow[] {
  return [...rows]
}
