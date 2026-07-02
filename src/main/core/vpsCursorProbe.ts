import { appendAppLog } from '../utils/log'
import { mihomoProxies } from './mihomoApi'
import { isCanonicalVpsNodeName } from './vpsCanonicalNodes'
import {
  generateCommercialNodeReport,
  pruneCommercialProbeSamples,
  probeLeafNodesWithCursorApi,
  refreshCommercialStabilityCache,
  ensureCommercialBenchmarkStorage,
  syncCursorNodeReportScheduler
} from './commercialNodeBenchmark'
import {
  formatCommercialBenchmarkBurstSkipReason,
  shouldSkipCommercialBenchmarkDuringBurst
} from './networkBurstGateCore'
import { getNetworkBurstUntilMs } from './networkStabilityMonitor'

export { CANONICAL_VPS_NODE_PATTERN, isCanonicalVpsNodeName } from './vpsCanonicalNodes'

const PROBE_INTERVAL_MS = 60_000
const CURSOR_PROBE_URL = 'https://api2.cursor.sh'
const EMPTY_NODES_LOG_INTERVAL_MS = 5 * 60_000

let probeTimer: NodeJS.Timeout | null = null
let isRunning = false
let isProbing = false
let lastEmptyNodesLogAt = 0

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function resolveVpsRegion(nodeName: string): string {
  if (nodeName.startsWith('KR-')) return 'KR-VPS'
  if (nodeName.startsWith('JP-')) return 'JP-VPS'
  return 'VPS'
}


export function isVpsCursorProbeRunning(): boolean {
  return isRunning
}

export async function listCanonicalVpsNodes(): Promise<
  Array<{ name: string; region: string; kind: 'vps' }>
> {
  const proxies = await mihomoProxies()
  const nodes: Array<{ name: string; region: string; kind: 'vps' }> = []
  for (const [name, entry] of Object.entries(proxies.proxies)) {
    if (!isCanonicalVpsNodeName(name)) continue
    if ('all' in entry) continue
    nodes.push({ name, region: resolveVpsRegion(name), kind: 'vps' })
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name))
  return nodes
}

async function runProbeCycle(): Promise<void> {
  if (!isRunning || isProbing) return
  if (shouldSkipCommercialBenchmarkDuringBurst(getNetworkBurstUntilMs())) {
    appendAppLog(
      `[VpsCursorProbe]: skip cycle — ${formatCommercialBenchmarkBurstSkipReason(getNetworkBurstUntilMs())}\n`
    )
    return
  }
  isProbing = true
  try {
    const nodes = await listCanonicalVpsNodes()
    if (nodes.length === 0) {
      const now = Date.now()
      if (now - lastEmptyNodesLogAt >= EMPTY_NODES_LOG_INTERVAL_MS) {
        lastEmptyNodesLogAt = now
        appendAppLog(
          '[VpsCursorProbe]: WARNING no canonical VPS nodes (KR|JP-VPS-Reality|HY2|TUIC)\n'
        )
      }
      return
    }

    await ensureCommercialBenchmarkStorage()
    await pruneCommercialProbeSamples()
    appendAppLog(
      `[VpsCursorProbe]: probing ${nodes.length} VPS nodes via ${CURSOR_PROBE_URL}\n`
    )
    await probeLeafNodesWithCursorApi(nodes)
    await refreshCommercialStabilityCache()
  } catch (error) {
    appendAppLog(`[VpsCursorProbe]: cycle error: ${formatError(error)}\n`)
  } finally {
    isProbing = false
  }
}

export async function startVpsCursorProbe(): Promise<void> {
  if (isRunning) return
  isRunning = true
  await ensureCommercialBenchmarkStorage()
  await pruneCommercialProbeSamples()
  appendAppLog(
    `[VpsCursorProbe]: started (interval=${PROBE_INTERVAL_MS / 1000}s, 24h window, shared report scheduler)\n`
  )

  void runProbeCycle()
  probeTimer = setInterval(() => {
    void runProbeCycle()
  }, PROBE_INTERVAL_MS)

  void generateCommercialNodeReport({ notify: false })
  await syncCursorNodeReportScheduler()
}

export function stopVpsCursorProbe(): void {
  if (probeTimer) {
    clearInterval(probeTimer)
    probeTimer = null
  }
  isRunning = false
  isProbing = false
  lastEmptyNodesLogAt = 0
  appendAppLog('[VpsCursorProbe]: stopped\n')
  void syncCursorNodeReportScheduler()
}

export async function restartVpsCursorProbe(): Promise<void> {
  stopVpsCursorProbe()
  await startVpsCursorProbe()
}
