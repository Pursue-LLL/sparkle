import {
  API2_PROBE_TARGET,
  SPLIT_BRAIN_CONTROL_TARGET,
  type ProbeAttribution
} from './cursorTransportHealthCore'

export const TRIANGULATION_KR_NODE = 'KR-VPS-Reality' as const
export const TRIANGULATION_JP_NODE = 'JP-VPS-Reality' as const

export type TriangulationLayerId =
  | 'paths_healthy'
  | 'active_path_degraded'
  | 'company_network_to_vps'
  | 'kr_path_degraded'
  | 'jp_path_degraded'
  | 'cursor_server_or_global'
  | 'inconclusive_missing_node'

export type TriangulationConfidence = 'definitive' | 'partial'

export interface TriangulationProbeSnapshot {
  proxy: string
  target: string
  ok: boolean
  delayMs: number
  message?: string
  skipped?: boolean
  skipReason?: string
}

export interface TriangulationVerdict {
  layer: TriangulationLayerId
  probeAttribution: ProbeAttribution | 'inconclusive'
  confidence: TriangulationConfidence
  summaryZh: string
  summaryEn: string
  limitationZh: string
  limitationEn: string
}

export interface TriangulationInput {
  kr: TriangulationProbeSnapshot
  jp: TriangulationProbeSnapshot
  marketplace: TriangulationProbeSnapshot
  active: TriangulationProbeSnapshot
}

function skippedProbe(proxy: string, skipReason: string, target: string = API2_PROBE_TARGET): TriangulationProbeSnapshot {
  return {
    proxy,
    target,
    ok: false,
    delayMs: 0,
    skipped: true,
    skipReason
  }
}

export function buildTriangulationProbePlan(
  availableNodes: ReadonlySet<string>,
  activeNodeName?: string
): TriangulationInput {
  const kr = availableNodes.has(TRIANGULATION_KR_NODE)
    ? { proxy: TRIANGULATION_KR_NODE, target: API2_PROBE_TARGET, ok: false, delayMs: 0 }
    : skippedProbe(TRIANGULATION_KR_NODE, 'node_not_in_profile')

  const jp = availableNodes.has(TRIANGULATION_JP_NODE)
    ? { proxy: TRIANGULATION_JP_NODE, target: API2_PROBE_TARGET, ok: false, delayMs: 0 }
    : skippedProbe(TRIANGULATION_JP_NODE, 'node_not_in_profile')

  const marketplaceHost = availableNodes.has(TRIANGULATION_KR_NODE)
    ? TRIANGULATION_KR_NODE
    : availableNodes.has(TRIANGULATION_JP_NODE)
      ? TRIANGULATION_JP_NODE
      : ''

  const marketplace: TriangulationProbeSnapshot = marketplaceHost
    ? {
        proxy: marketplaceHost,
        target: SPLIT_BRAIN_CONTROL_TARGET,
        ok: false,
        delayMs: 0
      }
    : skippedProbe('(none)', 'no_vps_reality_node', SPLIT_BRAIN_CONTROL_TARGET)

  const trimmedActive = activeNodeName?.trim()
  const active: TriangulationProbeSnapshot =
    trimmedActive && availableNodes.has(trimmedActive)
      ? { proxy: trimmedActive, target: API2_PROBE_TARGET, ok: false, delayMs: 0 }
      : skippedProbe(trimmedActive || '(none)', trimmedActive ? 'active_node_not_in_profile' : 'no_active_cursor_node')

  return { kr, jp, marketplace, active }
}

function isProbeAttempted(probe: TriangulationProbeSnapshot): boolean {
  return probe.skipped !== true
}

function isProbeOk(probe: TriangulationProbeSnapshot): boolean {
  return probe.skipped !== true && probe.ok
}

export function resolveTriangulationVerdict(input: TriangulationInput): TriangulationVerdict {
  const limitationZh =
    '本诊断仅覆盖 Mac→Sparkle TUN→VPS→目标 URL 全路径；未执行 VPS SSH 自检，无法单独证明 sing-box 进程内部故障。'
  const limitationEn =
    'This diagnostic covers Mac→Sparkle TUN→VPS→target URL only; VPS SSH self-test was not run, so sing-box internal faults cannot be isolated.'

  const krAttempted = isProbeAttempted(input.kr)
  const jpAttempted = isProbeAttempted(input.jp)
  const marketplaceAttempted = isProbeAttempted(input.marketplace)

  if (!marketplaceAttempted || (!krAttempted && !jpAttempted)) {
    return {
      layer: 'inconclusive_missing_node',
      probeAttribution: 'inconclusive',
      confidence: 'partial',
      summaryZh: '缺少 KR/JP Reality 节点，无法完成三点定责。',
      summaryEn: 'KR/JP Reality nodes missing; triangulation incomplete.',
      limitationZh,
      limitationEn
    }
  }

  const krOk = isProbeOk(input.kr)
  const jpOk = isProbeOk(input.jp)
  const marketplaceOk = isProbeOk(input.marketplace)

  const pairAttribution: ProbeAttribution = !marketplaceOk && !krOk && !jpOk
    ? 'offline'
    : !krOk && !jpOk && marketplaceOk
      ? 'node_degraded'
      : marketplaceOk && krOk && jpOk
        ? 'healthy'
        : 'node_degraded'

  if (!marketplaceOk && !krOk && !jpOk) {
    return {
      layer: 'cursor_server_or_global',
      probeAttribution: 'offline',
      confidence: 'definitive',
      summaryZh: 'api2、marketplace、KR/JP 全路径同时失败 — Cursor 服务端、DNS 或全局离线。',
      summaryEn: 'api2, marketplace, and KR/JP paths all failed — Cursor server, DNS, or global offline.',
      limitationZh,
      limitationEn
    }
  }

  if (marketplaceOk && !krOk && !jpOk && krAttempted && jpAttempted) {
    return {
      layer: 'company_network_to_vps',
      probeAttribution: 'node_degraded',
      confidence: 'definitive',
      summaryZh:
        'marketplace 正常但 KR/JP→api2 均失败 — 公司网到 VPS 路径问题（VPS sing-box 大概率仍存活）。',
      summaryEn:
        'marketplace OK but KR/JP→api2 failed — company network to VPS path issue (VPS sing-box likely alive).',
      limitationZh,
      limitationEn
    }
  }

  if (marketplaceOk && !krOk && jpOk && krAttempted) {
    return {
      layer: 'kr_path_degraded',
      probeAttribution: pairAttribution,
      confidence: 'definitive',
      summaryZh: 'KR→api2 失败、JP 正常 — KR 线路/路径问题，不是 Sparkle 全局故障。',
      summaryEn: 'KR→api2 failed while JP OK — KR path issue, not a global Sparkle fault.',
      limitationZh,
      limitationEn
    }
  }

  if (marketplaceOk && krOk && !jpOk && jpAttempted) {
    return {
      layer: 'jp_path_degraded',
      probeAttribution: pairAttribution,
      confidence: 'definitive',
      summaryZh: 'JP→api2 失败、KR 正常 — JP 线路/路径问题，不是 Sparkle 全局故障。',
      summaryEn: 'JP→api2 failed while KR OK — JP path issue, not a global Sparkle fault.',
      limitationZh,
      limitationEn
    }
  }

  if (marketplaceOk && krOk && jpOk) {
    const activeAttempted = isProbeAttempted(input.active)
    const activeOk = isProbeOk(input.active)
    if (activeAttempted && !activeOk) {
      return {
        layer: 'active_path_degraded',
        probeAttribution: 'node_degraded',
        confidence: 'definitive',
        summaryZh: `Reality 对照全通，但当前 Cursor 专用节点 ${input.active.proxy}→api2 失败 — L3 协议/隧道问题（非 Reality 误判）。`,
        summaryEn: `Reality controls OK but active Cursor node ${input.active.proxy}→api2 failed — L3 protocol/tunnel issue (not a false Reality healthy).`,
        limitationZh,
        limitationEn
      }
    }
    const activeSuffix =
      activeAttempted && activeOk
        ? `（含 active ${input.active.proxy} ${input.active.delayMs}ms）`
        : ''
    return {
      layer: 'paths_healthy',
      probeAttribution: 'healthy',
      confidence: 'definitive',
      summaryZh:
        `Reality 三点 + active 节点全通${activeSuffix} — 当前瞬间 Mac→VPS→Cursor 路径健康。若 Agent 仍断连，查 ledger/events @ A 时刻与 QUIC 长流瞬断。`,
      summaryEn:
        `Reality triad and active node OK${activeSuffix ? ` (${input.active.proxy})` : ''} — Mac→VPS→Cursor healthy at probe time. If Agent still drops, check ledger/events at incident time and QUIC long-stream drops.`,
      limitationZh,
      limitationEn
    }
  }

  if (marketplaceOk && !krOk && !jpOk && (!krAttempted || !jpAttempted)) {
    return {
      layer: 'inconclusive_missing_node',
      probeAttribution: 'inconclusive',
      confidence: 'partial',
      summaryZh: '仅部分 VPS 节点可测，结果不足以定责。',
      summaryEn: 'Only partial VPS nodes available; insufficient evidence.',
      limitationZh,
      limitationEn
    }
  }

  return {
    layer: 'inconclusive_missing_node',
    probeAttribution: 'inconclusive',
    confidence: 'partial',
    summaryZh: '探针结果组合非常规，请结合 core log 同秒行人工核对。',
    summaryEn: 'Unusual probe combination; correlate with core log lines at the same timestamp.',
    limitationZh,
    limitationEn
  }
}

export function formatTriangulationReport(
  input: TriangulationInput,
  verdict: TriangulationVerdict,
  ts: string
): string {
  const line = (probe: TriangulationProbeSnapshot): string => {
    if (probe.skipped) {
      return `${probe.proxy} ${probe.target}: SKIP (${probe.skipReason ?? 'unknown'})`
    }
    return `${probe.proxy} ${probe.target}: ${probe.ok ? 'OK' : 'FAIL'} ${probe.delayMs}ms${probe.message ? ` (${probe.message})` : ''}`
  }

  return [
    `[Triangulation ${ts}] layer=${verdict.layer} confidence=${verdict.confidence}`,
    line(input.kr),
    line(input.jp),
    line(input.marketplace),
    line(input.active),
    verdict.summaryZh,
    verdict.limitationZh
  ].join('\n')
}
