// [INPUT] networkPathMonitorCore · appendNetworkStabilityEvent
// [OUTPUT] startNetworkPathMonitor · stopNetworkPathMonitor
// [POS] P25b runtime — poll os.networkInterfaces for path_change events.

import os, { type NetworkInterfaceInfo } from 'os'
import { appendAppLog } from '../utils/log'
import { appendNetworkStabilityEvent } from './networkStabilityMonitor'
import {
  detectNetworkPathChange,
} from './networkPathMonitorCore'

const POLL_INTERVAL_MS = 15_000

let pollTimer: NodeJS.Timeout | null = null
let lastInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]> | null = null
let monitorStarted = false

export function startNetworkPathMonitor(): void {
  if (monitorStarted) {
    return
  }
  monitorStarted = true
  lastInterfaces = os.networkInterfaces()
  pollTimer = setInterval(() => {
    void pollNetworkPathOnce()
  }, POLL_INTERVAL_MS)
}

export function stopNetworkPathMonitor(): void {
  monitorStarted = false
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function resetNetworkPathMonitorForTests(): void {
  stopNetworkPathMonitor()
  lastInterfaces = null
}

async function pollNetworkPathOnce(): Promise<void> {
  const after = os.networkInterfaces()
  if (!lastInterfaces) {
    lastInterfaces = after
    return
  }
  const change = detectNetworkPathChange(lastInterfaces, after)
  lastInterfaces = after
  if (!change.changed) {
    return
  }
  const ts = new Date().toISOString()
  await appendNetworkStabilityEvent({
    ts,
    kind: 'path_change',
    from_proxy: change.beforeSummary,
    to_proxy: change.afterSummary,
    error_detail: `fingerprint ${change.beforeFingerprint} → ${change.afterFingerprint}`,
  })
  await appendAppLog(
    `[NetworkPathMonitor]: path_change before=${change.beforeSummary} after=${change.afterSummary}\n`,
  )
}
