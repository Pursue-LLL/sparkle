// [INPUT] mihomoApi · cursorTransportHealthCore API2 targets
// [OUTPUT] runHy2SessionNudgeDialPair · session dial in-flight guard
// [POS] P19 SSOT — shared HY2 session nudge dial (rescue + warmth executors).

import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import { API2_PROBE_TARGET, API2GEO_PROBE_TARGET } from './cursorTransportHealthCore'
import type { MihomoDelayOptions } from './mihomoApi'
import type { MarathonSessionKeepaliveResult } from './cursorHy2MarathonKeepaliveCore'
import type { DialIntent } from './dialAdmissionArbiterCore'

let lastHy2SessionKeepaliveAtMs = 0
let hy2SessionKeepaliveInFlight = false
let testHy2SessionNudgeDialPairOverride:
  | ((
      activeNode: string,
      delayOptions: MihomoDelayOptions | undefined,
    ) => Promise<{
      api2Result: { delay?: number; message?: string }
      api2geoResult: { delay?: number; message?: string }
    }>)
  | undefined

let skipMarathonSessionDialAppLogForTests = false

export function setSkipMarathonSessionDialAppLogForTests(skip: boolean): void {
  skipMarathonSessionDialAppLogForTests = skip
}

export function isSkipMarathonSessionDialAppLogForTests(): boolean {
  return skipMarathonSessionDialAppLogForTests
}

export function setHy2SessionNudgeDialPairOverrideForTests(
  override: typeof testHy2SessionNudgeDialPairOverride,
): void {
  testHy2SessionNudgeDialPairOverride = override
}

export function getLastHy2SessionKeepaliveAtMs(): number {
  return lastHy2SessionKeepaliveAtMs
}

export function setLastHy2SessionKeepaliveAtMs(nowMs: number): void {
  lastHy2SessionKeepaliveAtMs = nowMs
}

export function isHy2SessionDialInFlight(): boolean {
  return hy2SessionKeepaliveInFlight
}

export function tryAcquireHy2SessionDialInFlight(): boolean {
  if (hy2SessionKeepaliveInFlight) {
    return false
  }
  hy2SessionKeepaliveInFlight = true
  return true
}

export function releaseHy2SessionDialInFlight(): void {
  hy2SessionKeepaliveInFlight = false
}

export function resetMarathonSessionDialExecutorStateForTests(): void {
  lastHy2SessionKeepaliveAtMs = 0
  hy2SessionKeepaliveInFlight = false
  testHy2SessionNudgeDialPairOverride = undefined
  skipMarathonSessionDialAppLogForTests = false
}

export async function runHy2SessionNudgeDialPair(
  activeNode: string,
  delayOptions: MihomoDelayOptions | undefined,
): Promise<{
  api2Result: { delay?: number; message?: string }
  api2geoResult: { delay?: number; message?: string }
}> {
  if (testHy2SessionNudgeDialPairOverride) {
    return testHy2SessionNudgeDialPairOverride(activeNode, delayOptions)
  }
  const { mihomoProxyDelay } = await import('./mihomoApi')
  const api2Result = await mihomoProxyDelay(activeNode, API2_PROBE_TARGET, delayOptions)
  const api2geoResult = await mihomoProxyDelay(activeNode, API2GEO_PROBE_TARGET, delayOptions)
  return { api2Result, api2geoResult }
}

export interface ExecuteHy2SessionDialOptions {
  activeNode: string
  cursorConnectionCount: number
  nowMs: number
  delayOptions?: MihomoDelayOptions
  logKind: string
  weakProbeLogPrefix?: string
  /** G22: rescue dial already ran marathon_rescue probes — weak delay must not veto outcome. */
  forceOnWeakProbe?: boolean
  /** P10-2: non-production dial must pass admission arbiter before in-flight guard. */
  admissionIntent?: DialIntent
  /** P12: warmth dial uses observability budget queue. */
  useObservabilityBudget?: boolean
}

/** Shared dial body — callers own trigger-specific gates. */
export async function executeHy2SessionDialWithGuard(
  options: ExecuteHy2SessionDialOptions,
): Promise<MarathonSessionKeepaliveResult> {
  if (options.admissionIntent) {
    const { admitDialIntent } = await import('./dialAdmissionArbiter')
    const admission = admitDialIntent(options.admissionIntent)
    if (!admission.admitted) {
      return { outcome: 'skipped_admission', err: admission.reason }
    }
  }
  if (hy2SessionKeepaliveInFlight) {
    return { outcome: 'skipped_in_flight' }
  }

  hy2SessionKeepaliveInFlight = true
  try {
    let api2Result: { delay?: number; message?: string }
    let api2geoResult: { delay?: number; message?: string }
    if (options.useObservabilityBudget) {
      const runSessionNudgeDial = () =>
        runHy2SessionNudgeDialPair(options.activeNode, options.delayOptions)
      const { resolveMarathonObservabilityDialContext, withMarathonObservabilityDialBudget } =
        await import('./marathonObservabilityDialBudget')
      const dialContext = await resolveMarathonObservabilityDialContext()
      const budgetResult = await withMarathonObservabilityDialBudget(
        'session_nudge',
        dialContext,
        runSessionNudgeDial,
      )
      if (budgetResult.outcome === 'skipped_busy' || budgetResult.value === null) {
        return { outcome: 'skipped_budget_busy' }
      }
      ;({ api2Result, api2geoResult } = budgetResult.value)
    } else {
      ;({ api2Result, api2geoResult } = await runHy2SessionNudgeDialPair(
        options.activeNode,
        options.delayOptions,
      ))
    }
    const api2DelayMs = typeof api2Result.delay === 'number' ? api2Result.delay : 0
    const api2geoDelayMs = typeof api2geoResult.delay === 'number' ? api2geoResult.delay : 0
    const delayMs = Math.max(api2DelayMs, api2geoDelayMs)
    if (delayMs <= 0 && !options.forceOnWeakProbe) {
      const prefix = options.weakProbeLogPrefix ?? 'session_transport_nudge_weak'
      if (!skipMarathonSessionDialAppLogForTests) {
        const { appendAppLog } = await import('../utils/log')
        await appendAppLog(
          `[CursorHy2MarathonKeepalive]: ${prefix} node=${options.activeNode} cursor_conn=${options.cursorConnectionCount} api2_delay_ms=${api2DelayMs} api2geo_delay_ms=${api2geoDelayMs} msg=${api2Result.message ?? api2geoResult.message ?? 'none'}\n`,
        )
      }
      return {
        outcome: 'skipped_weak_probe',
        api2DelayMs,
        api2geoDelayMs,
      }
    }
    lastHy2SessionKeepaliveAtMs = options.nowMs
    if (!skipMarathonSessionDialAppLogForTests) {
      const { appendAppLog } = await import('../utils/log')
      const logKind =
        delayMs <= 0 && options.forceOnWeakProbe
          ? `${options.logKind}_weak_probe_rescue_forced`
          : options.logKind
      await appendAppLog(
        `[CursorHy2MarathonKeepalive]: ${logKind} node=${options.activeNode} cursor_conn=${options.cursorConnectionCount} api2_delay_ms=${api2DelayMs} api2geo_delay_ms=${api2geoDelayMs}\n`,
      )
      if (delayMs > 0) {
        const { appendApi2ProbeLedgerRow } = await import('./api2ProbeLedgerCore')
        await appendApi2ProbeLedgerRow({
          ts: new Date(options.nowMs).toISOString(),
          scope: 'active',
          node: options.activeNode,
          latency_ms: delayMs,
          ok: true,
          authoritative: true,
          method: 'session_nudge',
          probe_via: `mihomo_node:${options.activeNode}`,
          error_detail: `${logKind} api2=${api2DelayMs} api2geo=${api2geoDelayMs}`,
        })
      }
    }
    return {
      outcome: 'executed',
      api2DelayMs,
      api2geoDelayMs,
    }
  } catch (error) {
    const err = formatUnknownErrorForLog(error)
    if (!skipMarathonSessionDialAppLogForTests) {
      const { appendAppLog } = await import('../utils/log')
      await appendAppLog(
        `[CursorHy2MarathonKeepalive]: session_transport_nudge_failed node=${options.activeNode} cursor_conn=${options.cursorConnectionCount} err=${err}\n`,
      )
      const { recoverMihomoApiAfterNudgeFailure } = await import('./mihomoApiSocketWatchdog')
      await recoverMihomoApiAfterNudgeFailure(error)
    }
    return { outcome: 'failed', err }
  } finally {
    hy2SessionKeepaliveInFlight = false
  }
}

export function formatMarathonRescueDialLogLine(
  trigger: string,
  result: MarathonSessionKeepaliveResult,
  cursorConnectionCount: number,
): string {
  const parts = [
    `[MarathonRescueDial]: trigger=${trigger}`,
    `outcome=${result.outcome}`,
    `cursor_conn=${cursorConnectionCount}`,
  ]
  if (result.api2DelayMs != null) {
    parts.push(`api2_delay_ms=${result.api2DelayMs}`)
  }
  if (result.api2geoDelayMs != null) {
    parts.push(`api2geo_delay_ms=${result.api2geoDelayMs}`)
  }
  if (result.err) {
    parts.push(`err=${result.err}`)
  }
  return `${parts.join(' ')}\n`
}
