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

export interface ProxyDelayDisplay {
  delayMs: number
  source: ProxyDelayDisplaySource
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
      sampleTime: macLastTs || undefined,
      mihomoProbeTimedOut: false,
    }
  }

  const successfulHistory = latestSuccessfulProxyDelayHistoryEntry(history)
  if (successfulHistory) {
    return {
      delayMs: successfulHistory.delay,
      source: 'mihomo_history',
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
      sampleTime: vpsLastTs || undefined,
      mihomoProbeTimedOut: true,
    }
  }

  if (mihomoProbeTimedOut) {
    const latest = history?.[history.length - 1]
    return {
      delayMs: 0,
      source: 'none',
      sampleTime: latest?.time,
      mihomoProbeTimedOut: true,
    }
  }

  return {
    delayMs: -1,
    source: 'none',
    mihomoProbeTimedOut: false,
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
