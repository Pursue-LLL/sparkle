import { appendAppLog } from '../utils/log'
import {
  API2_PROBE_LEDGER_PATH,
  ensureApi2ProbeLedgerDir,
  pruneApi2ProbeLedger
} from './api2ProbeLedgerCore'
import { withApi2ProbePlaneLock, releaseApi2ProbePlaneLock } from './api2ProbePlaneCore'
import {
  getNetworkMonitorNextProbeDelayMs,
  runNetworkMonitorCycle,
  startNetworkStabilityMonitor,
  stopNetworkStabilityMonitor
} from './networkStabilityMonitor'

const PLANE_STARTUP_DELAY_MS = 5_000

let planeTimer: NodeJS.Timeout | null = null
let isPlaneRunning = false

function clearPlaneTimer(): void {
  if (planeTimer) {
    clearTimeout(planeTimer)
    planeTimer = null
  }
}

function schedulePlaneTick(delayMs: number): void {
  if (!isPlaneRunning) {
    return
  }
  clearPlaneTimer()
  planeTimer = setTimeout(() => {
    void runPlaneTick()
  }, delayMs)
}

async function runPlaneTick(): Promise<void> {
  if (!isPlaneRunning) {
    return
  }
  let nextDelayMs = getNetworkMonitorNextProbeDelayMs()
  await withApi2ProbePlaneLock('monitor', async () => {
    nextDelayMs = await runNetworkMonitorCycle()
  })
  const { maybeRunVpsL4ProbeCycle, shouldRunVpsL4ProbeCycle } = await import('./vpsL4Probe')
  if (shouldRunVpsL4ProbeCycle()) {
    await withApi2ProbePlaneLock('vps_l4', async () => {
      await maybeRunVpsL4ProbeCycle()
    })
  }
  schedulePlaneTick(nextDelayMs)
}

/** Bootstrap scheduler for active api2 transport probes (current Cursor node). */
export async function startApi2ProbePlane(): Promise<void> {
  if (isPlaneRunning) {
    return
  }
  await ensureApi2ProbeLedgerDir()
  await pruneApi2ProbeLedger()

  await startNetworkStabilityMonitor()

  isPlaneRunning = true

  await appendAppLog(
    `[Api2ProbePlane]: ON — active transport probe every 60s + VPS L4 ssh_curl every 300s → ${API2_PROBE_LEDGER_PATH}\n`
  )

  schedulePlaneTick(PLANE_STARTUP_DELAY_MS)
}

export async function stopApi2ProbePlane(): Promise<void> {
  isPlaneRunning = false
  clearPlaneTimer()
  stopNetworkStabilityMonitor()
  releaseApi2ProbePlaneLock()
  await appendAppLog('[Api2ProbePlane]: stopped\n')
}
