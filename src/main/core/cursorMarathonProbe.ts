/** Marathon / long-stream probe constants and implementation (no Electron imports — testable). */

export const CURSOR_STREAM_PROBE = 'https://api2.cursor.sh'
export const CURSOR_LONG_PROBE_TARGET = CURSOR_STREAM_PROBE
export const CURSOR_MARATHON_PROBE_HOLD_MS = 960_000
export const CURSOR_MARATHON_PROBE_INTERVAL_MS = 30 * 60_000
export const CURSOR_LONG_STREAM_15M_CAP_MIN_MS = 840_000
export const CURSOR_LONG_STREAM_15M_CAP_MAX_MS = 960_000
/** Unauthenticated api2 SSE returns this banner then closes in ~1s — not a proxy marathon fault. */
export const CURSOR_SSE_WELCOME_PREFIX = 'Welcome to Cursor'
export const LONG_PROBE_WELCOME_ONLY_MAX_MS = 5_000
/** Only treat early_close as proxy marathon fault after sustained hold past welcome phase. */
export const LONG_PROBE_PROXY_FAULT_MIN_HOLD_MS = 30_000

export interface CursorLongProbeResult {
  ok: boolean
  status?: number
  latencyMs: number
  holdMs: number
  earlyClose: boolean
  errorCode?: string
  errorDetail?: string
  /** True when api2 returned the unauthenticated welcome banner (marathon not measurable). */
  welcomeOnly?: boolean
  /** False when the probe cannot validate ~16min SSE hold (welcome-only or protocol error). */
  marathonApplicable?: boolean
  sseBytes?: number
}

export function isCursorSseWelcomeBanner(ssePrefix: string): boolean {
  return ssePrefix.includes(CURSOR_SSE_WELCOME_PREFIX)
}

export function isCursorLongProbeMarathonApplicable(probe: {
  welcomeOnly?: boolean
  marathonApplicable?: boolean
  errorCode?: string
}): boolean {
  if (probe.marathonApplicable === false) {
    return false
  }
  if (probe.welcomeOnly === true) {
    return false
  }
  if (probe.errorCode === 'LONG_PROBE_UNAUTH_WELCOME') {
    return false
  }
  return true
}

export function classifyCursorLongProbeOutcome(input: {
  earlyClose: boolean
  holdMs: number
  status?: number
  ssePrefix: string
  targetHoldMs?: number
}): Pick<
  CursorLongProbeResult,
  'ok' | 'errorCode' | 'errorDetail' | 'welcomeOnly' | 'marathonApplicable'
> {
  const targetHoldMs = input.targetHoldMs ?? CURSOR_MARATHON_PROBE_HOLD_MS
  const welcomeOnly =
    input.earlyClose &&
    input.holdMs < LONG_PROBE_WELCOME_ONLY_MAX_MS &&
    isCursorSseWelcomeBanner(input.ssePrefix)

  if (welcomeOnly) {
    return {
      ok: false,
      welcomeOnly: true,
      marathonApplicable: false,
      errorCode: 'LONG_PROBE_UNAUTH_WELCOME',
      errorDetail:
        'Unauthenticated api2 returns a welcome banner then closes; marathon hold requires an active Agent session'
    }
  }

  const is15mCap =
    input.earlyClose &&
    input.holdMs >= CURSOR_LONG_STREAM_15M_CAP_MIN_MS &&
    input.holdMs <= CURSOR_LONG_STREAM_15M_CAP_MAX_MS
  if (is15mCap) {
    return {
      ok: false,
      welcomeOnly: false,
      marathonApplicable: true,
      errorCode: 'LONG_STREAM_15M_CAP',
      errorDetail: `Stream closed after ${input.holdMs}ms (~15min proxy cap)`
    }
  }

  const transportOk = input.earlyClose
    ? input.holdMs >= targetHoldMs - 2_000
    : true
  if (transportOk && (input.status ?? 0) > 0 && (input.status ?? 0) < 500) {
    return {
      ok: true,
      welcomeOnly: false,
      marathonApplicable: true
    }
  }

  if (input.earlyClose && input.holdMs >= LONG_PROBE_PROXY_FAULT_MIN_HOLD_MS) {
    return {
      ok: false,
      welcomeOnly: false,
      marathonApplicable: true,
      errorCode: 'LONG_PROBE_EARLY_CLOSE',
      errorDetail: `Stream closed after ${input.holdMs}ms (hold target ${targetHoldMs}ms)`
    }
  }

  return {
    ok: false,
    welcomeOnly: false,
    marathonApplicable: false,
    errorCode: 'LONG_PROBE_INCONCLUSIVE',
    errorDetail: `Stream closed after ${input.holdMs}ms without sustained hold (no marathon verdict)`
  }
}

export function isCursorLongStream15mCap(probe: {
  earlyClose?: boolean
  holdMs?: number
  errorCode?: string
}): boolean {
  if (probe.errorCode === 'LONG_STREAM_15M_CAP') {
    return true
  }
  if (!probe.earlyClose || probe.holdMs === undefined) {
    return false
  }
  return (
    probe.holdMs >= CURSOR_LONG_STREAM_15M_CAP_MIN_MS &&
    probe.holdMs <= CURSOR_LONG_STREAM_15M_CAP_MAX_MS
  )
}

/** Hold api2 SSE up to ~16min — detects ~15min proxy long-stream caps on the Cursor path. */
export async function probeCursorApiLongHold(
  proxyHost: string,
  proxyPort: number,
  viaDirectTun = false
): Promise<CursorLongProbeResult> {
  const startedAt = Date.now()
  try {
    const axios = (await import('axios')).default
    const response = await axios.get(CURSOR_LONG_PROBE_TARGET, {
      ...(viaDirectTun
        ? {}
        : {
            proxy: {
              host: proxyHost,
              port: proxyPort,
              protocol: 'http'
            }
          }),
      timeout: CURSOR_MARATHON_PROBE_HOLD_MS + 15_000,
      validateStatus: () => true,
      maxRedirects: 0,
      responseType: 'stream',
      headers: {
        Accept: 'text/event-stream, application/connect+proto, */*',
        'User-Agent': 'Sparkle-LongProbe/1.0'
      }
    })

    if (response.status >= 500) {
      try {
        response.data.destroy()
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        holdMs: Date.now() - startedAt,
        earlyClose: true,
        errorCode: 'LONG_PROBE_HTTP_ERROR',
        errorDetail: `HTTP ${response.status} from ${CURSOR_LONG_PROBE_TARGET}`
      }
    }

    let earlyClose = false
    let ssePrefix = ''
    let sseBytes = 0
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          response.data.destroy()
        } catch {
          /* ignore stream teardown errors */
        }
        resolve()
      }
      const timer = setTimeout(finish, CURSOR_MARATHON_PROBE_HOLD_MS)
      response.data.on('error', () => {
        earlyClose = true
        finish()
      })
      response.data.on('end', () => {
        earlyClose = true
        finish()
      })
      response.data.on('close', () => {
        earlyClose = true
        finish()
      })
      response.data.on('data', (chunk: Buffer) => {
        sseBytes += chunk.length
        if (ssePrefix.length < 256) {
          ssePrefix += chunk.toString(
            'utf8',
            0,
            Math.min(chunk.length, 256 - ssePrefix.length)
          )
        }
      })
      response.data.resume()
    })

    const latencyMs = Date.now() - startedAt
    const classified = classifyCursorLongProbeOutcome({
      earlyClose,
      holdMs: latencyMs,
      status: response.status,
      ssePrefix
    })

    return {
      ...classified,
      status: response.status,
      latencyMs,
      holdMs: latencyMs,
      earlyClose,
      sseBytes
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      message?: string
      response?: { status?: number }
    }
    const latencyMs = Date.now() - startedAt
    return {
      ok: false,
      status: err.response?.status,
      latencyMs,
      holdMs: latencyMs,
      earlyClose: true,
      errorCode: err.code ?? 'LONG_PROBE_FAILED',
      errorDetail: err.message ?? String(error)
    }
  }
}

export interface CursorLongProbeSmokeResult {
  ok: boolean
  status?: number
  errorDetail?: string
}

const CURSOR_LONG_PROBE_SMOKE_FIRST_BYTE_MS = 8_000

/** Startup smoke: confirm api2 SSE endpoint returns a readable HTTP stream (not HPE / TLS garbage). */
export async function verifyCursorLongProbeTargetReachable(): Promise<CursorLongProbeSmokeResult> {
  const startedAt = Date.now()
  try {
    const axios = (await import('axios')).default
    const response = await axios.get(CURSOR_LONG_PROBE_TARGET, {
      timeout: 12_000,
      validateStatus: () => true,
      maxRedirects: 0,
      responseType: 'stream',
      headers: {
        Accept: 'text/event-stream, application/connect+proto, */*',
        'User-Agent': 'Sparkle-LongProbe-Smoke/1.0'
      }
    })

    if (response.status >= 500 || response.status === 0) {
      try {
        response.data.destroy()
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        status: response.status,
        errorDetail: `HTTP ${response.status} from ${CURSOR_LONG_PROBE_TARGET}`
      }
    }

    const gotStreamActivity = await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (value: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          response.data.destroy()
        } catch {
          /* ignore */
        }
        resolve(value)
      }
      const timer = setTimeout(() => finish(false), CURSOR_LONG_PROBE_SMOKE_FIRST_BYTE_MS)
      response.data.on('data', () => finish(true))
      response.data.on('error', () => finish(false))
      response.data.on('end', () => finish(true))
      response.data.resume()
    })

    if (!gotStreamActivity && Date.now() - startedAt >= CURSOR_LONG_PROBE_SMOKE_FIRST_BYTE_MS - 100) {
      return {
        ok: false,
        status: response.status,
        errorDetail: `No SSE bytes within ${CURSOR_LONG_PROBE_SMOKE_FIRST_BYTE_MS}ms from ${CURSOR_LONG_PROBE_TARGET}`
      }
    }

    return { ok: true, status: response.status }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      message?: string
      response?: { status?: number }
    }
    return {
      ok: false,
      status: err.response?.status,
      errorDetail: err.message ?? String(error)
    }
  }
}
