// [INPUT] none (pure parse + dedupe for Sparkle-side agent-transport-failures.jsonl writer)
// [OUTPUT] parseTransportFailureLine · shouldPersistTransportFailure · rowDedupeKey
// [POS] Stock Cursor + legacy Guard renderer/exthost lines → Connect partition rows.

export interface AgentTransportFailureRow {
  ts: number
  requestId?: string
  originalRequestId?: string
  composerId?: string
  proxyNode?: string
  reasonType?: string
  reasonSub?: string
  errMsg?: string
  connectCode?: string
  attempt?: number
  activeAgents?: number
  /** Marathon silent EOF duration from ifm-event-v1 stream_terminated payload. */
  durationMs?: number
  /** P16: jsonl row kind — network_diagnostic_ping_storm vs agent_transport_failure. */
  kind?: string
  /** P25a: renderer agent-error streamPrimarySub (e.g. server-eof). */
  streamPrimarySub?: string
  /** P25a: renderer agent-error disconnectPhase (e.g. phase1_stream). */
  disconnectPhase?: string
}

/** Align with P14c / cursorStreamTokenGapCore marathon silent EOF gate. */
export const SILENT_EOF_MARATHON_MIN_DURATION_MS = 1_800_000

/** P25a: HTTP SSE userMessage/resumeAction marathon silent server-eof gate. */
export const HTTP_SSE_MARATHON_MIN_DURATION_MS = 1_800_000

const TRANSPORT_ERR_RE =
  /PING timed out|\[unavailable\]|ECONNRESET|ETIMEDOUT|WritableIterable is closed|Stream ended without turnEnded|generation-ended-without-turnEnded|deadline exceeded|read ETIMEDOUT/i

export function parseLogField(line: string, key: string): string {
  const quoted = line.match(new RegExp(`${key}="([^"]*)"`))
  if (quoted?.[1] !== undefined) {
    return quoted[1]
  }
  const unquoted = line.match(new RegExp(`(?<![a-zA-Z0-9_])${key}=([^\\s,}]+)`))
  return unquoted?.[1] ?? ''
}

export function parseLogNumber(line: string, key: string): number {
  const match = line.match(new RegExp(`(?<![a-zA-Z0-9_])${key}=([0-9]+)`))
  return match ? Number(match[1]) : 0
}

function parseLogTimestampMs(line: string): number | undefined {
  const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/)
  if (!match) {
    return undefined
  }
  const parsed = Date.parse(match[1].replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function classifyTransportReason(
  errMsg: string,
  connectCode: string,
  durationMs?: number,
): {
  reasonType: string
  reasonSub: string
} {
  if (/PING timed out/i.test(errMsg)) {
    return { reasonType: 'proxy-network', reasonSub: 'dial-timeout' }
  }
  if (/ETIMEDOUT|read ETIMEDOUT/i.test(errMsg)) {
    return { reasonType: 'proxy-network', reasonSub: 'read-timeout' }
  }
  if (/ECONNRESET|WritableIterable is closed/i.test(errMsg)) {
    return { reasonType: 'proxy-network', reasonSub: 'tls-reset' }
  }
  if (/generation-ended-without-turnEnded|Stream ended without turnEnded/i.test(errMsg)) {
    if ((durationMs ?? 0) >= SILENT_EOF_MARATHON_MIN_DURATION_MS) {
      return { reasonType: 'proxy-network', reasonSub: 'connect-silent-eof' }
    }
    return { reasonType: 'cursor-server', reasonSub: 'stream-end-without-turn' }
  }
  if (connectCode === '14') {
    return { reasonType: 'proxy-network', reasonSub: 'dial-timeout' }
  }
  return { reasonType: 'proxy-network', reasonSub: 'transport' }
}

function parseIfmPatch99Line(line: string): AgentTransportFailureRow | undefined {
  if (!line.includes('[ifm-patch-99 transport-failure]')) {
    return undefined
  }
  const ts = parseLogNumber(line, 'ts') || parseLogTimestampMs(line) || 0
  if (ts <= 0) {
    return undefined
  }
  return {
    ts,
    requestId: parseLogField(line, 'requestId') || undefined,
    originalRequestId: parseLogField(line, 'originalRequestId') || undefined,
    composerId: parseLogField(line, 'composerId') || undefined,
    proxyNode: parseLogField(line, 'proxyNode') || undefined,
    reasonType: parseLogField(line, 'reasonType') || undefined,
    reasonSub: parseLogField(line, 'reasonSub') || undefined,
    errMsg: parseLogField(line, 'errMsg') || undefined,
    connectCode: parseLogField(line, 'connectCode') || undefined,
    attempt: parseLogNumber(line, 'attempt') || undefined,
    activeAgents: parseLogNumber(line, 'activeAgents') || undefined,
  }
}

function parseHttpSseServerEofAgentError(line: string): AgentTransportFailureRow | undefined {
  if (!line.includes('[ifm-patch-29 agent-error]')) {
    return undefined
  }
  const streamPrimarySub = parseLogField(line, 'streamPrimarySub')
  if (streamPrimarySub !== 'server-eof') {
    return undefined
  }
  const durationMs = parseLogNumber(line, 'durationMs') || undefined
  const ts = parseLogNumber(line, 'ts') || parseLogTimestampMs(line) || 0
  if (ts <= 0) {
    return undefined
  }
  const errMsg = parseLogField(line, 'errMsg') || 'server-eof'
  const disconnectPhase = parseLogField(line, 'disconnectPhase') || undefined
  return {
    ts,
    requestId: parseLogField(line, 'requestId') || undefined,
    originalRequestId: parseLogField(line, 'originalRequestId') || undefined,
    composerId: parseLogField(line, 'composerId') || undefined,
    reasonType: 'proxy-network',
    reasonSub: 'http-sse-server-eof',
    errMsg,
    connectCode: parseLogField(line, 'connectCode') || undefined,
    attempt: parseLogNumber(line, 'attempt') || undefined,
    activeAgents: parseLogNumber(line, 'activeAgents') || undefined,
    durationMs,
    streamPrimarySub,
    disconnectPhase,
    kind: 'http_sse_transport_failure',
  }
}

function parseIfmPatch29Line(line: string): AgentTransportFailureRow | undefined {
  const httpSse = parseHttpSseServerEofAgentError(line)
  if (httpSse) {
    return httpSse
  }
  if (!line.includes('[ifm-patch-29 agent-error]')) {
    return undefined
  }
  const errMsg = parseLogField(line, 'errMsg')
  const connectCode = parseLogField(line, 'connectCode')
  if (!TRANSPORT_ERR_RE.test(errMsg) && connectCode !== '14') {
    return undefined
  }
  const ts = parseLogNumber(line, 'ts') || parseLogTimestampMs(line) || 0
  if (ts <= 0) {
    return undefined
  }
  const classified = classifyTransportReason(errMsg, connectCode)
  return {
    ts,
    requestId: parseLogField(line, 'requestId') || undefined,
    originalRequestId: parseLogField(line, 'originalRequestId') || undefined,
    composerId: parseLogField(line, 'composerId') || undefined,
    reasonType: classified.reasonType,
    reasonSub: classified.reasonSub,
    errMsg: errMsg || undefined,
    connectCode: connectCode || undefined,
    attempt: parseLogNumber(line, 'attempt') || undefined,
    activeAgents: parseLogNumber(line, 'activeAgents') || undefined,
  }
}

function parseIfmEventV1Line(line: string): AgentTransportFailureRow | undefined {
  if (!line.includes('[ifm-event-v1]')) {
    return undefined
  }
  const jsonStart = line.indexOf('{')
  if (jsonStart < 0) {
    return undefined
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>
  } catch {
    return undefined
  }
  if (payload.eventKind !== 'stream_terminated') {
    return undefined
  }
  const nested =
    payload.payload && typeof payload.payload === 'object'
      ? (payload.payload as Record<string, unknown>)
      : {}
  const errMsg = String(nested.reason ?? payload.reason ?? '')
  const connectCode = String(nested.connectCode ?? payload.connectCode ?? '')
  const durationMs =
    typeof nested.durationMs === 'number' && Number.isFinite(nested.durationMs)
      ? nested.durationMs
      : undefined
  if (!TRANSPORT_ERR_RE.test(errMsg) && connectCode !== '14') {
    return undefined
  }
  const tsRaw = payload.occurredAtMs ?? nested.terminalMs ?? payload.ts
  const ts =
    typeof tsRaw === 'number' && Number.isFinite(tsRaw)
      ? tsRaw
      : parseLogTimestampMs(line) ?? 0
  if (ts <= 0) {
    return undefined
  }
  const classified = classifyTransportReason(errMsg, connectCode, durationMs)
  return {
    ts,
    requestId: String(payload.requestId ?? '').trim() || undefined,
    originalRequestId: String(payload.originalRequestId ?? payload.requestId ?? '').trim() || undefined,
    composerId: String(payload.composerId ?? '').trim() || undefined,
    reasonType: classified.reasonType,
    reasonSub: classified.reasonSub,
    errMsg: errMsg || undefined,
    connectCode: connectCode || undefined,
    durationMs,
    attempt:
      typeof payload.attempt === 'number'
        ? payload.attempt
        : parseLogNumber(line, 'attempt') || undefined,
    activeAgents:
      typeof nested.activeAgents === 'number'
        ? nested.activeAgents
        : parseLogNumber(line, 'activeAgents') || undefined,
  }
}

function parseRendererConnectErrorJsonLine(line: string): AgentTransportFailureRow | undefined {
  if (!/"name"\s*:\s*"ConnectError"/.test(line)) {
    return undefined
  }
  const jsonStart = line.indexOf('{')
  if (jsonStart < 0) {
    return undefined
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>
  } catch {
    return undefined
  }
  if (payload.name !== 'ConnectError') {
    return undefined
  }
  const rawMessage = String(payload.rawMessage ?? '').trim()
  const connectCode = String(payload.code ?? '')
  const errMsg =
    rawMessage ||
    String(payload.message ?? '').trim() ||
    (connectCode ? `ConnectError code=${connectCode}` : 'ConnectError')
  if (!TRANSPORT_ERR_RE.test(errMsg) && connectCode !== '14') {
    return undefined
  }
  const ts = parseLogTimestampMs(line)
  if (ts === undefined) {
    return undefined
  }
  const classified = classifyTransportReason(errMsg, connectCode)
  return {
    ts,
    reasonType: classified.reasonType,
    reasonSub: classified.reasonSub,
    errMsg,
    connectCode: connectCode || undefined,
  }
}

function parseExthostConnectErrorLine(line: string): AgentTransportFailureRow | undefined {
  if (!line.includes('ConnectError:') || !TRANSPORT_ERR_RE.test(line)) {
    return undefined
  }
  const ts = parseLogTimestampMs(line)
  if (ts === undefined) {
    return undefined
  }
  const errMsg = line.slice(line.indexOf('ConnectError:')).trim()
  const classified = classifyTransportReason(errMsg, '')
  return {
    ts,
    reasonType: classified.reasonType,
    reasonSub: classified.reasonSub,
    errMsg,
  }
}

function isNetworkDiagnosticTransportLine(line: string): boolean {
  return /Network Diagnostic|networkDiagnostics|network.?diagnostic|cursorNetworkDiagnostics/i.test(
    line,
  )
}

function tagNetworkDiagnosticKind(
  row: AgentTransportFailureRow,
  line: string,
): AgentTransportFailureRow {
  if (!isNetworkDiagnosticTransportLine(line)) {
    return row
  }
  return { ...row, kind: 'network_diagnostic_ping_storm' }
}

function metadataString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key]
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

function parseDiagnosticsField(message: string, key: string): string {
  const match = message.match(new RegExp(`${key}=([^\\s]+)`))
  return match?.[1]?.trim() ?? ''
}

function isPingTransportFailure(errMsg: string, connectCode: string): boolean {
  if (/PING timed out/i.test(errMsg)) {
    return true
  }
  if (connectCode === '14' && /unavailable|ping|ETIMEDOUT|read ETIMEDOUT/i.test(errMsg)) {
    return true
  }
  return connectCode === '14' && errMsg.length > 0
}

/** P17: Cursor NAL Structured Logs — Stream error / AGENT_ERROR_DIAGNOSTICS transport rows. */
function parseCursorStructuredTransportLine(line: string): AgentTransportFailureRow | undefined {
  const ts = parseLogTimestampMs(line)
  if (ts === undefined) {
    return undefined
  }
  const jsonStart = line.indexOf('{')
  if (jsonStart < 0) {
    return undefined
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>
  } catch {
    return undefined
  }
  const metadata =
    payload.metadata && typeof payload.metadata === 'object'
      ? (payload.metadata as Record<string, unknown>)
      : {}
  const message = String(payload.message ?? '')

  if (message.includes('Stream error reported from extension host')) {
    const errMsg = metadataString(metadata, 'error.message') || metadataString(metadata, 'errorMessage')
    const connectCode =
      metadataString(metadata, 'errorCode') || metadataString(metadata, 'error.code')
    if (!isPingTransportFailure(errMsg, connectCode)) {
      return undefined
    }
    const classified = classifyTransportReason(errMsg, connectCode)
    const requestId = metadataString(metadata, 'requestId')
    const originalRequestId =
      metadataString(metadata, 'originalRequestId') || requestId
    return {
      ts,
      requestId: requestId || undefined,
      originalRequestId: originalRequestId || undefined,
      composerId: metadataString(metadata, 'composerId') || undefined,
      reasonType: classified.reasonType,
      reasonSub: classified.reasonSub,
      errMsg: errMsg || undefined,
      connectCode: connectCode || undefined,
      attempt: Number(metadataString(metadata, 'attempt')) || undefined,
    }
  }

  if (message.includes('[AGENT_ERROR_DIAGNOSTICS]')) {
    const requestId =
      metadataString(metadata, 'requestId') || parseDiagnosticsField(message, 'requestId')
    const originalRequestId =
      metadataString(metadata, 'originalRequestId') ||
      parseDiagnosticsField(message, 'originalRequestId') ||
      requestId
    const connectCode =
      metadataString(metadata, 'underlyingConnectError.code') ||
      metadataString(metadata, 'error.displayInfo.connectCode')
    const codeName = metadataString(metadata, 'underlyingConnectError.codeName')
    const errMsg =
      connectCode === '14' || codeName === 'Unavailable'
        ? '[unavailable] PING timed out'
        : ''
    if (!isPingTransportFailure(errMsg, connectCode)) {
      return undefined
    }
    const classified = classifyTransportReason(errMsg, connectCode)
    return {
      ts,
      requestId: requestId || undefined,
      originalRequestId: originalRequestId || undefined,
      reasonType: classified.reasonType,
      reasonSub: classified.reasonSub,
      errMsg: errMsg || undefined,
      connectCode: connectCode || undefined,
      attempt: Number(metadataString(metadata, 'attempt')) || undefined,
    }
  }

  if (message.includes('RetriableError') || line.includes('RetriableError')) {
    const errMsg =
      metadataString(metadata, 'error.message') ||
      metadataString(metadata, 'rawMessage') ||
      (line.includes('PING timed out') ? '[unavailable] PING timed out' : '')
    const connectCode =
      metadataString(metadata, 'errorCode') ||
      metadataString(metadata, 'code') ||
      (errMsg.includes('PING timed out') ? '14' : '')
    if (!isPingTransportFailure(errMsg, connectCode)) {
      return undefined
    }
    const classified = classifyTransportReason(errMsg, connectCode)
    const requestId = metadataString(metadata, 'requestId')
    const originalRequestId =
      metadataString(metadata, 'originalRequestId') ||
      parseDiagnosticsField(message, 'originalRequestId') ||
      requestId
    return {
      ts,
      requestId: requestId || undefined,
      originalRequestId: originalRequestId || undefined,
      reasonType: classified.reasonType,
      reasonSub: classified.reasonSub,
      errMsg: errMsg || undefined,
      connectCode: connectCode || undefined,
      attempt: Number(metadataString(metadata, 'attempt')) || undefined,
    }
  }

  return undefined
}

function parseNetworkDiagnosticTransportLine(line: string): AgentTransportFailureRow | undefined {
  if (!isNetworkDiagnosticTransportLine(line)) {
    return undefined
  }
  const row =
    parseRendererConnectErrorJsonLine(line) ??
    parseExthostConnectErrorLine(line) ??
    undefined
  if (!row) {
    return undefined
  }
  return tagNetworkDiagnosticKind(row, line)
}

export function parseTransportFailureLine(line: string): AgentTransportFailureRow | undefined {
  const row =
    parseIfmPatch99Line(line) ??
    parseIfmPatch29Line(line) ??
    parseIfmEventV1Line(line) ??
    parseCursorStructuredTransportLine(line) ??
    parseNetworkDiagnosticTransportLine(line) ??
    parseRendererConnectErrorJsonLine(line) ??
    parseExthostConnectErrorLine(line)
  if (!row) {
    return undefined
  }
  if (row.kind === 'network_diagnostic_ping_storm') {
    return row
  }
  return tagNetworkDiagnosticKind(row, line)
}

export function shouldPersistTransportFailure(row: AgentTransportFailureRow): boolean {
  const errMsg = String(row.errMsg ?? '')
  const connectCode = String(row.connectCode ?? '')
  if (row.reasonSub === 'http-sse-server-eof') {
    return (row.durationMs ?? 0) >= HTTP_SSE_MARATHON_MIN_DURATION_MS
  }
  if (row.reasonSub === 'stream-end-without-turn') {
    return false
  }
  if (row.reasonSub === 'connect-silent-eof') {
    return (row.durationMs ?? 0) >= SILENT_EOF_MARATHON_MIN_DURATION_MS
  }
  if (row.reasonSub === 'max-steps-cap' || row.reasonSub === 'max-steps') {
    return true
  }
  if (/maximum number of steps/i.test(errMsg)) {
    return true
  }
  if (/PING timed out/i.test(errMsg) || connectCode === '14') {
    return true
  }
  if (
    row.reasonSub === 'dial-timeout' ||
    row.reasonSub === 'tls-reset' ||
    row.reasonSub === 'read-timeout' ||
    row.reasonSub === 'connect-silent-eof'
  ) {
    return true
  }
  return TRANSPORT_ERR_RE.test(errMsg)
}

export function rowDedupeKey(row: Pick<AgentTransportFailureRow, 'ts' | 'requestId'>): string {
  const bucket = Math.floor(row.ts / 5_000)
  return `${bucket}|${row.requestId ?? ''}`
}
