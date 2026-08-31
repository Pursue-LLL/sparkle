// [INPUT] profile check errors · sidecar/data-plane probe outcomes
// [OUTPUT] retry policy · phase labels · readiness error codes
// [POS] Pure SSOT for Core Readiness Contract (unit-tested, no Electron I/O).

export type CoreReadinessPhase = 'sidecar' | 'profile' | 'tun' | 'data_plane'

export type CoreReadinessErrorCode =
  | 'SIDECAR_UNREACHABLE'
  | 'PROFILE_CHECK_FAILED'
  | 'TUN_PERMISSION_TIMEOUT'
  | 'DATA_PLANE_NOT_READY'

export class CoreReadinessError extends Error {
  readonly code: CoreReadinessErrorCode
  readonly phase: CoreReadinessPhase

  constructor(code: CoreReadinessErrorCode, phase: CoreReadinessPhase, message: string) {
    super(message)
    this.name = 'CoreReadinessError'
    this.code = code
    this.phase = phase
  }
}

export const SIDECAR_PROBE_TIMEOUT_MS = 5_000
export const TUN_PERMISSION_TIMEOUT_MS = 60_000
export const TUN_PERMISSION_LOG_INTERVAL_MS = 10_000
export const PROFILE_CHECK_MAX_ATTEMPTS = 3
export const PROFILE_CHECK_RETRY_DELAY_MS = 2_000
export const DATA_PLANE_READY_MAX_MS = 30_000

export function shouldRetryProfileCheck(message: string): boolean {
  return message.toLowerCase().includes('not found')
}

export function formatCoreReadinessPhaseLog(
  phase: CoreReadinessPhase,
  outcome: string,
  detail = '',
): string {
  const suffix = detail.length > 0 ? ` ${detail}` : ''
  return `[CoreReadiness]: phase=${phase} outcome=${outcome}${suffix}\n`
}

/** Reject PCRE inline flags in JS regex literals — Node SyntaxError at runtime. */
export function findInvalidJsRegexPcrePatterns(source: string): string[] {
  const hits: string[] = []
  const pattern = /\/\(\?[a-z]*\)/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    hits.push(match[0])
  }
  return hits
}

export function assertNoInvalidJsRegexPcreInBundle(mainSource: string): void {
  const hits = findInvalidJsRegexPcrePatterns(mainSource)
  if (hits.length > 0) {
    throw new Error(
      `asar bundle contains invalid JS regex PCRE flags: ${hits.slice(0, 3).join(', ')}`,
    )
  }
}
