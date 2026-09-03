// [INPUT] sparkle core/app logs · network-stability-events.jsonl
// [OUTPUT] classify disconnect signals into L1/L2/L3/L7 layers (SSOT taxonomy)
// [POS] Phase 0 — automatic attribution without business-logic changes

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'

/** dscl SSOT — C2/C3 isolated HOME must not hide real Sparkle logs. */
export function resolveSparkleDataHome(): string {
  const fromEnv =
    process.env.SPARKLE_ATTRIBUTION_HOME?.trim() ||
    process.env.CURSOR_MAINTAIN_REAL_HOME?.trim() ||
    process.env.REAL_HOME?.trim()
  if (fromEnv) {
    return fromEnv
  }
  const user = userInfo().username
  const out = spawnSync('dscl', ['.', '-read', `/Users/${user}`, 'NFSHomeDirectory'], {
    encoding: 'utf8',
  })
  const match = out.stdout?.match(/NFSHomeDirectory:\s*(.+)/)
  return match?.[1]?.trim() || homedir()
}

export type AttributionLayer = 'L1' | 'L2' | 'L3' | 'L7' | 'L_EXTERNAL' | 'L_MULTI'

export type AttributionConfidence = 'definitive' | 'partial' | 'hint'

export type AttributionSource = 'core' | 'app' | 'stability'

export interface AttributionSignal {
  tsMs: number
  layer: AttributionLayer
  mechanism: string
  evidence: string
  source: AttributionSource
}

export interface AttributionIncident {
  tsMs: number
  primaryLayer: AttributionLayer
  confidence: AttributionConfidence
  mechanisms: string[]
  signals: AttributionSignal[]
}

export interface AttributionScanStats {
  coreLinesScanned: number
  appLinesScanned: number
  stabilityLinesScanned: number
  jpVpsConnectErrors: number
  jpVpsSuccessRoutes: number
  quicStallEvents: number
  sparkleProcessHealthy: boolean
}

const LAYER_RANK: Record<AttributionLayer, number> = {
  L2: 0,
  L_MULTI: 1,
  L3: 2,
  L7: 3,
  L1: 4,
  L_EXTERNAL: 5,
}

const CLUSTER_WINDOW_MS = 2_000

function parseCoreTimestamp(line: string): number {
  const match = line.match(/^time="([^"]+)"/)
  return match ? Date.parse(match[1]!) : NaN
}

function parseAppTimestamp(line: string): number {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
  return match ? Date.parse(match[1]!) : NaN
}

function parseJsonTs(raw: string): number {
  try {
    const row = JSON.parse(raw) as { ts?: string }
    return row.ts ? Date.parse(row.ts) : NaN
  } catch {
    return NaN
  }
}

function signal(
  tsMs: number,
  layer: AttributionLayer,
  mechanism: string,
  evidence: string,
  source: AttributionSource,
): AttributionSignal | null {
  if (!Number.isFinite(tsMs)) {
    return null
  }
  return { tsMs, layer, mechanism, evidence: evidence.trim(), source }
}

export function classifyCoreLogLine(line: string): AttributionSignal | null {
  const tsMs = parseCoreTimestamp(line)
  if (!Number.isFinite(tsMs)) {
    return null
  }

  if (/45\.76\.104\.78:443 connect error: context deadline exceeded/.test(line)) {
    return signal(
      tsMs,
      'L3',
      'jp_vps_inbound_connect_deadline',
      line,
      'core',
    )
  }

  if (/failed to create session: dial tcp [\d.]+:\d+: connect: connection refused/.test(line)) {
    return signal(tsMs, 'L_EXTERNAL', 'commercial_node_session_refused', line, 'core')
  }

  if (/context deadline exceeded/.test(line) && /level=warning/.test(line)) {
    return signal(tsMs, 'L_MULTI', 'mihomo_global_dial_deadline', line, 'core')
  }

  if (/activate health check/.test(line)) {
    return signal(tsMs, 'L_MULTI', 'provider_health_check_cascade', line, 'core')
  }

  return null
}

export function classifyAppLogLine(line: string): AttributionSignal | null {
  const tsMs = parseAppTimestamp(line)
  if (!Number.isFinite(tsMs)) {
    return null
  }

  if (/\[CursorTransportHealth\]: L3/.test(line) || /restartCore/.test(line)) {
    return signal(tsMs, 'L2', 'sparkle_core_restart_or_l3_recovery', line, 'app')
  }

  if (/\[CursorTransportHealth\]: L2/.test(line) || /flushed all mihomo outbound/.test(line)) {
    return signal(tsMs, 'L2', 'sparkle_l2_outbound_flush', line, 'app')
  }

  if (/\[CursorTransportHealth\]: L1/.test(line) || /L0 closed/.test(line)) {
    return signal(tsMs, 'L2', 'sparkle_connection_hygiene_close', line, 'app')
  }

  if (/core_cold_restart|MarathonCoreRestartGuard|mutation/i.test(line)) {
    return signal(tsMs, 'L2', 'sparkle_data_plane_mutation', line, 'app')
  }

  if (/mihomo_quic_silent_stall|MihomoQuicSilentStall/.test(line)) {
    return signal(tsMs, 'L3', 'quic_silent_stall', line, 'app')
  }

  if (/RecoveryHonesty\].*outcome=ineffective/.test(line)) {
    return signal(tsMs, 'L3', 'recovery_ineffective', line, 'app')
  }

  if (/connect_path_delay_ms=([5-9]\d{3}|\d{4,})/.test(line)) {
    return signal(tsMs, 'L2', 'probe_contention_spike', line, 'app')
  }

  if (/max-steps-cap|silent_generation_end/.test(line)) {
    return signal(tsMs, 'L7', 'cursor_max_steps_or_generation_end', line, 'app')
  }

  if (/resumeAction|EH unresponsive/.test(line)) {
    return signal(tsMs, 'L1', 'cursor_resume_action_ghost', line, 'app')
  }

  return null
}

export function classifyStabilityEventLine(line: string): AttributionSignal | null {
  const tsMs = parseJsonTs(line)
  if (!Number.isFinite(tsMs)) {
    return null
  }

  if (/mihomo_quic_silent_stall/.test(line)) {
    return signal(tsMs, 'L3', 'quic_silent_stall_jsonl', line, 'stability')
  }

  if (/token_gap_rescue_ineffective/.test(line)) {
    return signal(tsMs, 'L3', 'token_gap_rescue_ineffective', line, 'stability')
  }

  if (/core_cold_restart|transport_partition/.test(line)) {
    return signal(tsMs, 'L2', 'stability_transport_partition', line, 'stability')
  }

  return null
}

export function countJpVpsRoutes(coreLine: string): { success: number; error: number } {
  let success = 0
  let error = 0
  if (/JP-VPS-Reality\]/.test(coreLine) && /level=info/.test(coreLine)) {
    success = 1
  }
  if (/45\.76\.104\.78:443 connect error/.test(coreLine)) {
    error = 1
  }
  return { success, error }
}

export function dedupeAttributionSignals(signals: AttributionSignal[]): AttributionSignal[] {
  const seen = new Set<string>()
  const out: AttributionSignal[] = []
  for (const item of signals) {
    const key = `${item.tsMs}|${item.layer}|${item.mechanism}|${item.source}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(item)
  }
  return out
}

function pickPrimaryLayer(signals: AttributionSignal[]): AttributionLayer {
  const hasJpVpsApi2 = signals.some(
    (item) =>
      item.mechanism === 'jp_vps_inbound_connect_deadline' &&
      /api2/i.test(item.evidence),
  )
  if (hasJpVpsApi2) {
    return 'L3'
  }
  const layers = new Set(signals.map((item) => item.layer))
  if (layers.has('L2')) {
    return 'L2'
  }
  const multiCount = signals.filter((item) => item.layer === 'L_MULTI').length
  const l3Count = signals.filter((item) => item.layer === 'L3').length
  if (multiCount >= 3 && l3Count <= 1) {
    return 'L_MULTI'
  }
  if (layers.has('L3')) {
    return 'L3'
  }
  if (layers.has('L7')) {
    return 'L7'
  }
  if (layers.has('L1')) {
    return 'L1'
  }
  if (layers.has('L_EXTERNAL')) {
    return 'L_EXTERNAL'
  }
  return 'L_MULTI'
}

function pickConfidence(primary: AttributionLayer, signals: AttributionSignal[]): AttributionConfidence {
  if (primary === 'L3' && signals.some((item) => item.mechanism === 'jp_vps_inbound_connect_deadline')) {
    return 'definitive'
  }
  if (primary === 'L2' && signals.some((item) => item.mechanism.includes('mutation') || item.mechanism.includes('restart'))) {
    return 'definitive'
  }
  if (primary === 'L_MULTI' && signals.length >= 5) {
    return 'definitive'
  }
  if (signals.length >= 2) {
    return 'partial'
  }
  return 'hint'
}

export function clusterAttributionSignals(
  signals: AttributionSignal[],
  windowMs: number = CLUSTER_WINDOW_MS,
): AttributionIncident[] {
  const sorted = dedupeAttributionSignals(signals).sort((a, b) => a.tsMs - b.tsMs)
  const incidents: AttributionIncident[] = []
  let bucket: AttributionSignal[] = []

  const flush = (): void => {
    if (bucket.length === 0) {
      return
    }
    const primaryLayer = pickPrimaryLayer(bucket)
    const mechanisms = [...new Set(bucket.map((item) => item.mechanism))]
    incidents.push({
      tsMs: bucket[0]!.tsMs,
      primaryLayer,
      confidence: pickConfidence(primaryLayer, bucket),
      mechanisms,
      signals: [...bucket],
    })
    bucket = []
  }

  for (const item of sorted) {
    if (bucket.length === 0) {
      bucket.push(item)
      continue
    }
    const anchor = bucket[0]!
    if (item.tsMs - anchor.tsMs <= windowMs) {
      bucket.push(item)
    } else {
      flush()
      bucket.push(item)
    }
  }
  flush()
  return incidents
}

function formatLocalTime(tsMs: number): string {
  return new Date(tsMs).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

function layerLabel(layer: AttributionLayer): string {
  switch (layer) {
    case 'L1':
      return 'L1 · Cursor EH/resumeAction 幽灵计次'
    case 'L2':
      return 'L2 · Sparkle 数据面自伤（restart/flush/dial storm）'
    case 'L3':
      return 'L3 · 代理/VPS 传输（QUIC stall / 入站超时）'
    case 'L7':
      return 'L7 · Cursor 服务端硬限（max-steps 等）'
    case 'L_EXTERNAL':
      return 'EXTERNAL · 商业节点/外部链路'
    case 'L_MULTI':
      return 'MULTI · mihomo 全局层瞬时拥塞'
  }
}

function summarizeStats(stats: AttributionScanStats): string[] {
  const jpTotal = stats.jpVpsConnectErrors + stats.jpVpsSuccessRoutes
  const jpErrorPct =
    jpTotal > 0 ? ((100 * stats.jpVpsConnectErrors) / jpTotal).toFixed(2) : 'n/a'
  return [
    `- Sparkle 进程：${stats.sparkleProcessHealthy ? '运行中' : '未检测到'}`,
    `- JP-VPS-Reality 路由：成功 ${stats.jpVpsSuccessRoutes} · connect error ${stats.jpVpsConnectErrors}（${jpErrorPct}%）`,
    `- QUIC stall 事件：${stats.quicStallEvents}`,
    `- 扫描行数：core ${stats.coreLinesScanned} · app ${stats.appLinesScanned} · stability ${stats.stabilityLinesScanned}`,
  ]
}

export function formatAttributionReport(
  incidents: AttributionIncident[],
  options: {
    sinceMs: number
    untilMs: number
    stats: AttributionScanStats
  },
): string {
  const lines: string[] = []
  lines.push('# Marathon Stability · Phase 0 归因报告')
  lines.push('')
  lines.push(
    `窗口：${formatLocalTime(options.sinceMs)} → ${formatLocalTime(options.untilMs)} (Asia/Shanghai)`,
  )
  lines.push('')
  lines.push('## 扫描统计')
  lines.push(...summarizeStats(options.stats))
  lines.push('')

  const byLayer = new Map<AttributionLayer, number>()
  for (const incident of incidents) {
    byLayer.set(incident.primaryLayer, (byLayer.get(incident.primaryLayer) ?? 0) + 1)
  }

  lines.push('## 层级汇总')
  if (incidents.length === 0) {
    lines.push('- 窗口内未检测到可归因事件（不代表零断连，可能缺 RID/渲染器日志）')
  } else {
    for (const layer of Object.keys(LAYER_RANK).sort(
      (a, b) => LAYER_RANK[a as AttributionLayer] - LAYER_RANK[b as AttributionLayer],
    )) {
      const count = byLayer.get(layer as AttributionLayer) ?? 0
      if (count > 0) {
        lines.push(`- ${layerLabel(layer as AttributionLayer)}：**${count}** 次`)
      }
    }
  }
  lines.push('')

  lines.push('## 事件明细（按时间）')
  if (incidents.length === 0) {
    lines.push('_无_')
  } else {
    for (const incident of incidents) {
      lines.push(
        `### ${formatLocalTime(incident.tsMs)} · ${layerLabel(incident.primaryLayer)} · ${incident.confidence}`,
      )
      lines.push(`- 机制：${incident.mechanisms.join(', ')}`)
      const sample = incident.signals[0]?.evidence ?? ''
      lines.push(`- 证据片段：\`${sample.slice(0, 220).replace(/\s+/g, ' ')}\``)
      lines.push('')
    }
  }

  lines.push('## 解读铁律')
  lines.push('- **L2 优先于 L3**：若是 Sparkle 自生 dial/restart，先修控制面，再怪节点')
  lines.push('- **L_MULTI**：多节点同秒 deadline → Mac/mihomo 全局层，非单 VPS 挂')
  lines.push('- **L3 jp_vps_inbound_connect_deadline**：VPS 入站 443 超时，需 VPS sing-box 日志对齐')
  lines.push('- **无法承诺 100% 零断连**；本报告目标 = 每次异常 **5 分钟内可归因**')
  lines.push('')
  return lines.join('\n')
}

export function scanLogTextForSignals(
  coreText: string,
  appText: string,
  stabilityText: string,
  sinceMs: number,
  untilMs: number,
): { signals: AttributionSignal[]; stats: AttributionScanStats } {
  const signals: AttributionSignal[] = []
  const stats: AttributionScanStats = {
    coreLinesScanned: 0,
    appLinesScanned: 0,
    stabilityLinesScanned: 0,
    jpVpsConnectErrors: 0,
    jpVpsSuccessRoutes: 0,
    quicStallEvents: 0,
    sparkleProcessHealthy: true,
  }

  for (const line of coreText.split('\n')) {
    if (!line.trim()) {
      continue
    }
    stats.coreLinesScanned += 1
    const tsMs = parseCoreTimestamp(line)
    if (Number.isFinite(tsMs) && tsMs >= sinceMs && tsMs <= untilMs) {
      const route = countJpVpsRoutes(line)
      stats.jpVpsSuccessRoutes += route.success
      stats.jpVpsConnectErrors += route.error
      const classified = classifyCoreLogLine(line)
      if (classified) {
        signals.push(classified)
      }
    }
  }

  for (const line of appText.split('\n')) {
    if (!line.trim()) {
      continue
    }
    stats.appLinesScanned += 1
    const tsMs = parseAppTimestamp(line)
    if (Number.isFinite(tsMs) && tsMs >= sinceMs && tsMs <= untilMs) {
      if (/mihomo_quic_silent_stall|MihomoQuicSilentStall/.test(line)) {
        stats.quicStallEvents += 1
      }
      const classified = classifyAppLogLine(line)
      if (classified) {
        signals.push(classified)
      }
    }
  }

  for (const line of stabilityText.split('\n')) {
    if (!line.trim()) {
      continue
    }
    stats.stabilityLinesScanned += 1
    const tsMs = parseJsonTs(line)
    if (Number.isFinite(tsMs) && tsMs >= sinceMs && tsMs <= untilMs) {
      if (/mihomo_quic_silent_stall/.test(line)) {
        stats.quicStallEvents += 1
      }
      const classified = classifyStabilityEventLine(line)
      if (classified) {
        signals.push(classified)
      }
    }
  }

  return { signals, stats }
}

export function scanSparkleLogsForSignals(options: {
  corePaths: readonly string[]
  appPaths: readonly string[]
  stabilityPath: string
  sinceMs: number
  untilMs: number
}): { signals: AttributionSignal[]; stats: AttributionScanStats; linesScanned: number } {
  const coreText = options.corePaths.map((path) => readFileSyncSafe(path)).join('\n')
  const appText = options.appPaths.map((path) => readFileSyncSafe(path)).join('\n')
  const stabilityText = readFileSyncSafe(options.stabilityPath)
  const { signals, stats } = scanLogTextForSignals(
    coreText,
    appText,
    stabilityText,
    options.sinceMs,
    options.untilMs,
  )
  const structuredPlaceholder = 0
  const linesScanned =
    stats.coreLinesScanned +
    stats.appLinesScanned +
    stats.stabilityLinesScanned +
    structuredPlaceholder
  return { signals, stats, linesScanned }
}

function readFileSyncSafe(path: string): string {
  if (!path || !existsSync(path)) {
    return ''
  }
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}
