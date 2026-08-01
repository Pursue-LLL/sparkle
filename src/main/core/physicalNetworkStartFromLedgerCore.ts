// [INPUT] validated-ledger network_started + stream_terminated envelopes
// [OUTPUT] parseNetworkStartedLedgerLine · projectPhysicalNetworkStarts
// [POS] P10-5 — physical rolling100 cohort from networkStartId SSOT.

import type {
  PhysicalNetworkStartOrigin,
  PhysicalNetworkStartRecord,
  PhysicalStreamOutcome,
} from './physicalMaxStepsRateCore'
import type { ValidatedLedgerTerminalRow } from './validatedLedgerTerminalCore'
import { isMaxStepsLedgerTerminal } from './validatedLedgerTerminalCore'

export interface ParsedNetworkStartedLedgerRow {
  ts: number
  networkStartId: string
  rendererBootId: string
  composerId?: string
  originalRequestId?: string
  requestId?: string
  httpStartMs: number
  origin?: PhysicalNetworkStartOrigin
}

interface LedgerEnvelope {
  eventKind?: string
  occurredAtMs?: number
  requestId?: string
  originalRequestId?: string
  composerId?: string
  networkStartId?: string
  rendererBootId?: string
  payload?: {
    networkStartId?: string
    rendererBootId?: string
    httpStartMs?: number
    origin?: string
  }
}

interface LedgerLine {
  envelope?: LedgerEnvelope
}

function readOrigin(raw: string | undefined): PhysicalNetworkStartOrigin | undefined {
  if (
    raw === 'manual' ||
    raw === 'stock_retry' ||
    raw === 'stock_reconnect' ||
    raw === 'stock_resume' ||
    raw === 'auto_continue' ||
    raw === 'unknown'
  ) {
    return raw
  }
  return undefined
}

export function parseNetworkStartedLedgerLine(line: string): ParsedNetworkStartedLedgerRow | undefined {
  const trimmed = line.trim()
  if (!trimmed) {
    return undefined
  }
  let parsed: LedgerLine
  try {
    parsed = JSON.parse(trimmed) as LedgerLine
  } catch {
    return undefined
  }
  const envelope = parsed.envelope
  if (!envelope || envelope.eventKind !== 'network_started') {
    return undefined
  }
  const payload = envelope.payload ?? {}
  const networkStartId = String(payload.networkStartId ?? envelope.networkStartId ?? '').trim()
  const rendererBootId = String(payload.rendererBootId ?? envelope.rendererBootId ?? '').trim()
  const httpStartMs =
    typeof payload.httpStartMs === 'number' && Number.isFinite(payload.httpStartMs)
      ? payload.httpStartMs
      : typeof envelope.occurredAtMs === 'number'
        ? envelope.occurredAtMs
        : 0
  if (!networkStartId || !rendererBootId || httpStartMs <= 0) {
    return undefined
  }
  return {
    ts: typeof envelope.occurredAtMs === 'number' ? envelope.occurredAtMs : httpStartMs,
    networkStartId,
    rendererBootId,
    composerId: envelope.composerId,
    originalRequestId: envelope.originalRequestId,
    requestId: envelope.requestId,
    httpStartMs,
    origin: readOrigin(payload.origin),
  }
}

export function countHttpSegmentStartedLedgerLines(lines: readonly string[]): number {
  let count = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      const parsed = JSON.parse(trimmed) as LedgerLine
      if (parsed.envelope?.eventKind === 'http_segment_started') {
        count += 1
      }
    } catch {
      continue
    }
  }
  return count
}

function terminalOutcome(row: ValidatedLedgerTerminalRow): PhysicalStreamOutcome {
  if (isMaxStepsLedgerTerminal(row)) {
    return 'max_steps'
  }
  const kind = String(row.terminalKind ?? '').toLowerCase()
  if (kind === 'normal_turn_end' || kind === 'silent_generation_end') {
    return 'turn_ended'
  }
  if (kind === 'user_stop') {
    return 'user_stop'
  }
  if (kind === 'server_eof' || kind === 'tls_reset' || kind === 'proxy_network') {
    return 'transport_error'
  }
  if (kind === 'guard_local_block' || kind === 'agent_error_disconnect') {
    return 'application_reject'
  }
  if (kind === 'connect_aborted') {
    return 'transport_error'
  }
  return 'unknown'
}

function terminalKey(row: ValidatedLedgerTerminalRow): string {
  return String(row.originalRequestId || row.requestId || '').trim()
}

function startCorrelationKey(row: ParsedNetworkStartedLedgerRow): string {
  return String(row.originalRequestId || row.requestId || row.networkStartId).trim()
}

export function projectPhysicalNetworkStarts(input: {
  starts: readonly ParsedNetworkStartedLedgerRow[]
  terminals: readonly ValidatedLedgerTerminalRow[]
}): PhysicalNetworkStartRecord[] {
  const latestTerminalByKey = new Map<string, ValidatedLedgerTerminalRow>()
  for (const terminal of input.terminals) {
    const key = terminalKey(terminal)
    if (!key) {
      continue
    }
    const prev = latestTerminalByKey.get(key)
    if (!prev || terminal.ts >= prev.ts) {
      latestTerminalByKey.set(key, terminal)
    }
  }

  const records: PhysicalNetworkStartRecord[] = []
  for (const start of input.starts) {
    const key = startCorrelationKey(start)
    const terminal = key ? latestTerminalByKey.get(key) : undefined
    records.push({
      networkStartId: start.networkStartId,
      rendererBootId: start.rendererBootId,
      composerId: start.composerId,
      startedAtMs: start.httpStartMs,
      origin: start.origin,
      outcome: terminal ? terminalOutcome(terminal) : undefined,
      closedAtMs: terminal?.ts,
    })
  }
  return records
}
