// [INPUT] latencyTruthFromLedgerCore · proxy delay history entries
// [OUTPUT] resolveVpsLeafProxyDelayDisplay · resolveVpsLeafEffectiveAlive
// [POS] VPS leaf UI delay/alive must not show "超时/离线" when ssh_curl body benchmark is healthy.

import type { LatencyTruthSummary } from './latencyTruthFromLedgerCore'

export interface ProxyDelayHistoryEntry {
  time: string
  delay: number
}

export type ProxyDelayDisplaySource =
  | 'mac_full_path'
  | 'mihomo_history'
  | 'vps_body_ssh'
  | 'none'

/** How the delay number was derived — drives honest age labeling in the list UI. */
export type ProxyDelayKind = 'none' | 'p50' | 'last_probe' | 'probe_timeout'

export interface ProxyDelayDisplay {
  delayMs: number
  source: ProxyDelayDisplaySource
  delayKind: ProxyDelayKind
  sampleTime?: string
  mihomoProbeTimedOut: boolean
}

export function latestSuccessfulProxyDelayHistoryEntry(
  history: ProxyDelayHistoryEntry[] | undefined,
): ProxyDelayHistoryEntry | undefined {
  if (!history?.length) {
    return undefined
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (entry && entry.delay > 0) {
      return entry
    }
  }
  return undefined
}

export function hasTrailingMihomoDelayTimeout(
  history: ProxyDelayHistoryEntry[] | undefined,
): boolean {
  if (!history?.length) {
    return false
  }
  return history[history.length - 1]?.delay === 0
}

export function isVpsBodyBenchmarkHealthy(
  truth: LatencyTruthSummary | null | undefined,
): boolean {
  return (
    typeof truth?.vpsBodyP50 === 'number' &&
    truth.vpsBodyP50 > 0 &&
    (truth.vpsBodySamples ?? 0) > 0
  )
}

export function resolveVpsLeafProxyDelayDisplay(
  history: ProxyDelayHistoryEntry[] | undefined,
  truth: LatencyTruthSummary | null | undefined,
): ProxyDelayDisplay {
  const macP50 = truth?.macFullPathP50
  if (typeof macP50 === 'number' && macP50 > 0) {
    const macLastTs = truth?.macFullPathLastTs?.trim()
    return {
      delayMs: Math.round(macP50),
      source: 'mac_full_path',
      delayKind: 'p50',
      sampleTime: macLastTs || undefined,
      mihomoProbeTimedOut: false,
    }
  }

  const successfulHistory = latestSuccessfulProxyDelayHistoryEntry(history)
  if (successfulHistory) {
    return {
      delayMs: successfulHistory.delay,
      source: 'mihomo_history',
      delayKind: 'last_probe',
      sampleTime: successfulHistory.time,
      mihomoProbeTimedOut: false,
    }
  }

  const mihomoProbeTimedOut = hasTrailingMihomoDelayTimeout(history)
  if (mihomoProbeTimedOut && isVpsBodyBenchmarkHealthy(truth)) {
    const vpsLastTs = truth!.vpsBodyLastTs?.trim()
    return {
      delayMs: Math.round(truth!.vpsBodyP50!),
      source: 'vps_body_ssh',
      delayKind: 'p50',
      sampleTime: vpsLastTs || undefined,
      mihomoProbeTimedOut: true,
    }
  }

  if (mihomoProbeTimedOut) {
    const latest = history?.[history.length - 1]
    return {
      delayMs: 0,
      source: 'none',
      delayKind: 'probe_timeout',
      sampleTime: latest?.time,
      mihomoProbeTimedOut: true,
    }
  }

  return {
    delayMs: -1,
    source: 'none',
    delayKind: 'none',
    mihomoProbeTimedOut: false,
  }
}

/** Contract: positive delays must declare kind; last_probe must carry sampleTime. */
export function assertProxyDelayDisplaySampleIntegrity(display: ProxyDelayDisplay): void {
  if (display.delayMs === -1) {
    if (display.delayKind !== 'none') {
      throw new Error(`untested delay must use delayKind=none, got ${display.delayKind}`)
    }
    return
  }
  if (display.delayMs === 0) {
    if (display.delayKind !== 'probe_timeout') {
      throw new Error(`timeout delay must use delayKind=probe_timeout, got ${display.delayKind}`)
    }
    return
  }
  if (display.delayKind === 'last_probe' && !display.sampleTime?.trim()) {
    throw new Error('last_probe display requires sampleTime from mihomo history')
  }
  if (display.delayKind === 'p50' && display.source !== 'mac_full_path' && display.source !== 'vps_body_ssh') {
    throw new Error(`p50 delayKind requires mac_full_path or vps_body_ssh source, got ${display.source}`)
  }
}

export function resolveVpsLeafEffectiveAlive(
  mihomoAlive: boolean | undefined,
  truth: LatencyTruthSummary | null | undefined,
  mihomoProbeTimedOut: boolean,
): boolean {
  if (mihomoAlive === true) {
    return true
  }
  if (mihomoProbeTimedOut && isVpsBodyBenchmarkHealthy(truth)) {
    return true
  }
  return mihomoAlive ?? false
}

export function proxyDelayDisplayColor(
  display: ProxyDelayDisplay,
): 'primary' | 'success' | 'warning' | 'danger' {
  if (display.delayMs === -1) {
    return 'primary'
  }
  if (display.delayMs === 0) {
    return 'danger'
  }
  if (display.source === 'vps_body_ssh' && display.mihomoProbeTimedOut) {
    return display.delayMs < 500 ? 'warning' : 'warning'
  }
  if (display.delayMs < 500) {
    return 'success'
  }
  return 'warning'
}
