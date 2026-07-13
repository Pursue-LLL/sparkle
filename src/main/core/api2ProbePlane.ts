import { appendAppLog } from '../utils/log'
import {
  API2_PROBE_LEDGER_PATH,
  ensureApi2ProbeLedgerDir,
  pruneApi2ProbeLedger
} from './api2ProbeLedgerCore'
import {
  tryAcquireApi2ProbePlaneLock,
  releaseApi2ProbePlaneLock,
  withApi2ProbePlaneLock
} from './api2ProbePlaneCore'
import {
  getNetworkMonitorNextProbeDelayMs,
  runNetworkMonitorCycle,
  startNetworkStabilityMonitor,
  stopNetworkStabilityMonitor
} from './networkStabilityMonitor'
import {
  resolveCommercialBenchmarkConfig,
  runVpsCanonicalProbeCycle,
  startCommercialNodeBenchmark,
  stopCommercialNodeBenchmark
} from './commercialNodeBenchmark'

const PLANE_STARTUP_DELAY_MS = 5_000
const VPS_CANONICAL_PROBE_PHASE_OFFSET_MS = 15_000

let planeTimer: NodeJS.Timeout | null = null
let isPlaneRunning = false
let planeStartedAtMs = 0
let lastVpsRunAtMs = 0

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

async function maybeRunVpsBatch(): Promise<void> {
  const config = await resolveCommercialBenchmarkConfig()
  if (!config.enabled || !config.includeVps) {
    return
  }
  const nowMs = Date.now()
  if (nowMs - planeStartedAtMs < VPS_CANONICAL_PROBE_PHASE_OFFSET_MS) {
    return
  }
  const intervalMs = Math.max(30, config.intervalSec) * 1000
  if (nowMs - lastVpsRunAtMs < intervalMs) {
    return
  }
  if (!tryAcquireApi2ProbePlaneLock()) {
    return
  }
  try {
    lastVpsRunAtMs = nowMs
    await runVpsCanonicalProbeCycle()
  } finally {
    releaseApi2ProbePlaneLock()
  }
}

async function runPlaneTick(): Promise<void> {
  if (!isPlaneRunning) {
    return
  }
  let nextDelayMs = getNetworkMonitorNextProbeDelayMs()
  await withApi2ProbePlaneLock('monitor', async () => {
    nextDelayMs = await runNetworkMonitorCycle()
  })
  await maybeRunVpsBatch()
  schedulePlaneTick(nextDelayMs)
}

/** Single bootstrap + scheduler for api2 active probe + VPS ranking batch. */
export async function startApi2ProbePlane(): Promise<void> {
  if (isPlaneRunning) {
    return
  }
  await ensureApi2ProbeLedgerDir()
  await pruneApi2ProbeLedger()

  await startNetworkStabilityMonitor()
  await startCommercialNodeBenchmark()

  isPlaneRunning = true
  planeStartedAtMs = Date.now()
  lastVpsRunAtMs = 0

  await appendAppLog(
    `[Api2ProbePlane]: ON — unified tick (active→${API2_PROBE_LEDGER_PATH} scope=active; VPS→scope=vps; mutex=global)\n`
  )

  schedulePlaneTick(PLANE_STARTUP_DELAY_MS)
}

export async function stopApi2ProbePlane(): Promise<void> {
  isPlaneRunning = false
  clearPlaneTimer()
  stopNetworkStabilityMonitor()
  stopCommercialNodeBenchmark()
  releaseApi2ProbePlaneLock()
  await appendAppLog('[Api2ProbePlane]: stopped\n')
}
