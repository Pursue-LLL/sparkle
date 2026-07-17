import { appendAppLog, getCachedMihomoLogs } from '../utils/log'
import { mihomoProxies, mihomoProxyDelay, mihomoGroups } from './mihomoApi'
import { resolveCursorStableSelectorGroup } from './cursorProxyGroup'
import {
  API2_PROBE_TARGET,
  SPLIT_BRAIN_CONTROL_TARGET
} from './cursorTransportHealthCore'
import {
  buildTriangulationProbePlan,
  formatTriangulationReport,
  resolveTriangulationVerdict,
  TRIANGULATION_JP_NODE,
  TRIANGULATION_KR_NODE,
  type TriangulationInput,
  type TriangulationProbeSnapshot,
  type TriangulationVerdict
} from './networkTriangulationDiagnosticCore'

export interface NetworkTriangulationReport {
  ts: string
  probes: TriangulationInput
  verdict: TriangulationVerdict
  logExcerpt: string[]
}

async function probeNodeDelay(
  proxy: string,
  target: string
): Promise<TriangulationProbeSnapshot> {
  try {
    const result = await mihomoProxyDelay(proxy, target)
    const delayMs = result.delay ?? 0
    const ok = delayMs > 0 && !result.message
    return {
      proxy,
      target,
      ok,
      delayMs,
      message: result.message
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      proxy,
      target,
      ok: false,
      delayMs: 0,
      message
    }
  }
}

async function collectAvailableVpsNodes(): Promise<Set<string>> {
  const proxies = await mihomoProxies()
  return new Set(Object.keys(proxies.proxies ?? {}))
}

function readRecentCoreLogHints(maxLines: number = 5): string[] {
  const lines = getCachedMihomoLogs()
  const hints: string[] = []
  for (let index = lines.length - 1; index >= 0 && hints.length < maxLines; index -= 1) {
    const line = lines[index]?.payload ?? ''
    if (
      /Start initial compatible provider|connect error: context deadline exceeded|configs\?force/i.test(
        line
      )
    ) {
      hints.unshift(line.trim())
    }
  }
  return hints
}

/** Manual triangulation: KR/JP Reality + active Cursor node + marketplace control via mihomo full path. */
export async function runNetworkTriangulationDiagnostic(): Promise<NetworkTriangulationReport> {
  const ts = new Date().toISOString()
  const available = await collectAvailableVpsNodes()
  const groups = await mihomoGroups()
  const activeNodeName = resolveCursorStableSelectorGroup(groups)?.now
  const plan = buildTriangulationProbePlan(available, activeNodeName)

  const probeTasks: Array<Promise<TriangulationProbeSnapshot>> = [
    plan.kr.skipped ? Promise.resolve(plan.kr) : probeNodeDelay(TRIANGULATION_KR_NODE, API2_PROBE_TARGET),
    plan.jp.skipped ? Promise.resolve(plan.jp) : probeNodeDelay(TRIANGULATION_JP_NODE, API2_PROBE_TARGET),
    plan.marketplace.skipped
      ? Promise.resolve(plan.marketplace)
      : probeNodeDelay(plan.marketplace.proxy, SPLIT_BRAIN_CONTROL_TARGET),
    plan.active.skipped
      ? Promise.resolve(plan.active)
      : probeNodeDelay(plan.active.proxy, API2_PROBE_TARGET)
  ]

  const [kr, jp, marketplace, active] = await Promise.all(probeTasks)

  const probes: TriangulationInput = { kr, jp, marketplace, active }
  const verdict = resolveTriangulationVerdict(probes)
  const logExcerpt = readRecentCoreLogHints()

  const body = formatTriangulationReport(probes, verdict, ts)
  await appendAppLog(`[NetworkTriangulation]:\n${body}\n`)

  return { ts, probes, verdict, logExcerpt }
}
