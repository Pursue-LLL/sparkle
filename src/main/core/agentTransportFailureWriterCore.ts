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
}

const TRANSPORT_ERR_RE =
  /PING timed out|\[unavailable\]|ECONNRESET|ETIMEDOUT|WritableIterable is closed|Stream ended without turnEnded|deadline exceeded|read ETIMEDOUT/i

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

function classifyTransportReason(errMsg: string, connectCode: string): {
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

function parseIfmPatch29Line(line: string): AgentTransportFailureRow | undefined {
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
  const classified = classifyTransportReason(errMsg, connectCode)
  return {
    ts,
    requestId: String(payload.requestId ?? '').trim() || undefined,
    originalRequestId: String(payload.originalRequestId ?? payload.requestId ?? '').trim() || undefined,
    composerId: String(payload.composerId ?? '').trim() || undefined,
    reasonType: classified.reasonType,
    reasonSub: classified.reasonSub,
    errMsg: errMsg || undefined,
    connectCode: connectCode || undefined,
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

export function parseTransportFailureLine(line: string): AgentTransportFailureRow | undefined {
  return (
    parseIfmPatch99Line(line) ??
    parseIfmPatch29Line(line) ??
    parseIfmEventV1Line(line) ??
    parseRendererConnectErrorJsonLine(line) ??
    parseExthostConnectErrorLine(line)
  )
}

export function shouldPersistTransportFailure(row: AgentTransportFailureRow): boolean {
  const errMsg = String(row.errMsg ?? '')
  const connectCode = String(row.connectCode ?? '')
  if (/PING timed out/i.test(errMsg) || connectCode === '14') {
    return true
  }
  if (row.reasonSub === 'dial-timeout' || row.reasonSub === 'tls-reset' || row.reasonSub === 'read-timeout') {
    return true
  }
  return TRANSPORT_ERR_RE.test(errMsg)
}

export function rowDedupeKey(row: Pick<AgentTransportFailureRow, 'ts' | 'requestId'>): string {
  const bucket = Math.floor(row.ts / 5_000)
  return `${bucket}|${row.requestId ?? ''}`
}
