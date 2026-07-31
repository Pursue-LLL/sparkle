// [INPUT] Guard validated-ledger stream_terminated envelope
// [OUTPUT] parse · classify max-steps · merge with jsonl terminals
// [POS] G8 Plane F — SSOT turn terminal for MaxStepsRate (ledger primary, jsonl gap-fill).

import type { AgentTransportFailureRow } from './connectPartitionDetectCore'

export interface ValidatedLedgerTerminalRow {
  ts: number
  originalRequestId: string
  requestId?: string
  composerId?: string
  terminalKind?: string
  streamPrimarySub?: string
  reason?: string
  willRetry?: boolean
  lastSseCase?: string
  isMaxSteps: boolean
}

interface ValidatedLedgerEnvelope {
  eventKind?: string
  occurredAtMs?: number
  requestId?: string
  originalRequestId?: string
  composerId?: string
  payload?: {
    terminalKind?: string
    terminalMs?: number
    streamPrimarySub?: string
    reason?: string
    willRetry?: boolean
    lastSseCase?: string
    reasonSub?: string
  }
}

interface ValidatedLedgerLine {
  envelope?: ValidatedLedgerEnvelope
}

export function isMaxStepsLedgerTerminal(row: ValidatedLedgerTerminalRow): boolean {
  if (row.isMaxSteps) {
    return true
  }
  const reason = String(row.reason ?? '')
  if (/maximum number of steps/i.test(reason)) {
    return true
  }
  const lastSseCase = String(row.lastSseCase ?? '').toLowerCase()
  if (lastSseCase === 'stepcompleted' && row.willRetry === false && !row.streamPrimarySub?.includes('eof')) {
    const sub = String(row.streamPrimarySub ?? '').toLowerCase()
    if (sub === 'transport' || sub === 'max-steps-cap' || sub === 'max-steps') {
      return /maximum number of steps/i.test(reason)
    }
  }
  return false
}

export function parseValidatedLedgerTerminalLine(line: string): ValidatedLedgerTerminalRow | undefined {
  const trimmed = line.trim()
  if (!trimmed) {
    return undefined
  }
  let parsed: ValidatedLedgerLine
  try {
    parsed = JSON.parse(trimmed) as ValidatedLedgerLine
  } catch {
    return undefined
  }
  const envelope = parsed.envelope
  if (!envelope || envelope.eventKind !== 'stream_terminated') {
    return undefined
  }
  const originalRequestId = String(
    envelope.originalRequestId ?? envelope.requestId ?? '',
  ).trim()
  if (!originalRequestId) {
    return undefined
  }
  const payload = envelope.payload ?? {}
  const reason = payload.reason ?? ''
  const reasonSub = String(payload.reasonSub ?? '').toLowerCase()
  const isMaxSteps =
    reasonSub === 'max-steps-cap' ||
    reasonSub === 'max-steps' ||
    /maximum number of steps/i.test(reason)
  const ts =
    typeof payload.terminalMs === 'number'
      ? payload.terminalMs
      : typeof envelope.occurredAtMs === 'number'
        ? envelope.occurredAtMs
        : 0
  return {
    ts,
    originalRequestId,
    requestId: envelope.requestId,
    composerId: envelope.composerId,
    terminalKind: payload.terminalKind,
    streamPrimarySub: payload.streamPrimarySub,
    reason,
    willRetry: payload.willRetry,
    lastSseCase: payload.lastSseCase,
    isMaxSteps,
  }
}

export function ledgerTerminalToFailureRow(row: ValidatedLedgerTerminalRow): AgentTransportFailureRow {
  if (isMaxStepsLedgerTerminal(row)) {
    return {
      ts: row.ts,
      originalRequestId: row.originalRequestId,
      requestId: row.requestId,
      reasonSub: 'max-steps-cap',
      errMsg: row.reason ?? 'Reached maximum number of steps',
    }
  }
  return {
    ts: row.ts,
    originalRequestId: row.originalRequestId,
    requestId: row.requestId,
    reasonSub: row.streamPrimarySub ?? row.terminalKind ?? 'ledger-terminal',
    errMsg: row.reason,
  }
}

export function latestLedgerTerminalByOriginalRequestId(
  rows: readonly ValidatedLedgerTerminalRow[],
): Map<string, ValidatedLedgerTerminalRow> {
  const latest = new Map<string, ValidatedLedgerTerminalRow>()
  for (const row of rows) {
    const prev = latest.get(row.originalRequestId)
    if (!prev || row.ts >= prev.ts) {
      latest.set(row.originalRequestId, row)
    }
  }
  return latest
}

export function mergeTerminalsForMaxStepsRate(
  jsonlRows: readonly AgentTransportFailureRow[],
  ledgerRows: readonly ValidatedLedgerTerminalRow[],
): Map<string, AgentTransportFailureRow> {
  const jsonlLatest = latestTerminalByOriginalRequestIdFromJsonl(jsonlRows)
  const ledgerLatest = latestLedgerTerminalByOriginalRequestId(ledgerRows)
  const merged = new Map(jsonlLatest)

  for (const [originalRequestId, ledgerRow] of ledgerLatest) {
    const jsonlRow = merged.get(originalRequestId)
    const ledgerFailure = ledgerTerminalToFailureRow(ledgerRow)
    if (!jsonlRow) {
      merged.set(originalRequestId, ledgerFailure)
      continue
    }
    const jsonlTs = typeof jsonlRow.ts === 'number' ? jsonlRow.ts : 0
    if (ledgerRow.ts >= jsonlTs || isMaxStepsLedgerTerminal(ledgerRow)) {
      merged.set(originalRequestId, ledgerFailure)
    }
  }
  return merged
}

function latestTerminalByOriginalRequestIdFromJsonl(
  rows: readonly AgentTransportFailureRow[],
): Map<string, AgentTransportFailureRow> {
  const latest = new Map<string, AgentTransportFailureRow>()
  for (const row of rows) {
    const originalRequestId = String(row.originalRequestId ?? row.requestId ?? '').trim()
    if (!originalRequestId) {
      continue
    }
    const ts = typeof row.ts === 'number' ? row.ts : 0
    const prev = latest.get(originalRequestId)
    if (!prev || ts >= (prev.ts ?? 0)) {
      latest.set(originalRequestId, row)
    }
  }
  return latest
}
