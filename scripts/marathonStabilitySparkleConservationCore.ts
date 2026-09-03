// [INPUT] Sparkle core/app/stability signals · agent-transport-failures.jsonl
// [OUTPUT] Sparkle-only conservation report (zero Cursor log dependency)
// [POS] Phase 0.5 decoupled — mihomo/Sparkle SSOT metrics only

import { existsSync, readFileSync } from 'node:fs'
import type { AttributionIncident, AttributionLayer, AttributionSignal } from './marathonStabilityAttributionCore'
import { clusterAttributionSignals } from './marathonStabilityAttributionCore'

export interface SparkleTransportFailureRow {
  tsMs: number
  requestId: string
  proxyNode: string
  reasonType: string
  reasonSub: string
  errMsg: string
}

export interface SparkleConservationReport {
  sinceMs: number
  untilMs: number
  incidents: AttributionIncident[]
  transportFailures: SparkleTransportFailureRow[]
  probeSignalCount: number
  layerCounts: Partial<Record<AttributionLayer | 'L_MULTI' | 'L_EXTERNAL', number>>
}

const PROBE_MECHANISMS = new Set([
  'quic_silent_stall',
  'quic_silent_stall_jsonl',
  'probe_contention_spike',
  'token_gap_rescue_ineffective',
])

export function scanAgentTransportFailures(
  jsonlPath: string,
  sinceMs: number,
  untilMs: number,
): SparkleTransportFailureRow[] {
  if (!jsonlPath || !existsSync(jsonlPath)) {
    return []
  }
  const rows: SparkleTransportFailureRow[] = []
  for (const line of readFileSync(jsonlPath, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue
    }
    try {
      const row = JSON.parse(line) as {
        ts?: number
        requestId?: string
        proxyNode?: string
        reasonType?: string
        reasonSub?: string
        errMsg?: string
      }
      const tsMs = typeof row.ts === 'number' ? row.ts : NaN
      if (!Number.isFinite(tsMs) || tsMs < sinceMs || tsMs > untilMs) {
        continue
      }
      rows.push({
        tsMs,
        requestId: String(row.requestId ?? ''),
        proxyNode: String(row.proxyNode ?? ''),
        reasonType: String(row.reasonType ?? ''),
        reasonSub: String(row.reasonSub ?? ''),
        errMsg: String(row.errMsg ?? ''),
      })
    } catch {
      continue
    }
  }
  return rows
}

export function buildSparkleConservationReport(options: {
  sinceMs: number
  untilMs: number
  signals: AttributionSignal[]
  transportFailures: SparkleTransportFailureRow[]
}): SparkleConservationReport {
  const incidents = clusterAttributionSignals(options.signals)
  const probeSignalCount = options.signals.filter((item) => PROBE_MECHANISMS.has(item.mechanism)).length
  const layerCounts: SparkleConservationReport['layerCounts'] = {}
  for (const incident of incidents) {
    layerCounts[incident.primaryLayer] = (layerCounts[incident.primaryLayer] ?? 0) + 1
  }
  return {
    sinceMs: options.sinceMs,
    untilMs: options.untilMs,
    incidents,
    transportFailures: options.transportFailures,
    probeSignalCount,
    layerCounts,
  }
}

function formatLocal(tsMs: number): string {
  return new Date(tsMs).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

export function formatSparkleConservationReport(
  report: SparkleConservationReport,
  meta: {
    dataHome: string
    coreFileCount: number
    appFileCount: number
    linesScanned: number
    matrixLimit?: number
  },
): string {
  const limit = meta.matrixLimit ?? 8
  const lines: string[] = []
  lines.push('# Marathon Stability · Sparkle-only 守恒报告（无 Cursor 耦合）')
  lines.push('')
  lines.push(`dataHome: \`${meta.dataHome}\``)
  lines.push(`core=${meta.coreFileCount} · app=${meta.appFileCount} · 扫描行数=${meta.linesScanned}`)
  lines.push(`窗口：${formatLocal(report.sinceMs)} → ${formatLocal(report.untilMs)}`)
  lines.push('')
  lines.push('## Sparkle 守恒（信号层）')
  lines.push(`- 聚类 incident：**${report.incidents.length}**`)
  lines.push(`- 探测/stall 信号（非终端故障）：**${report.probeSignalCount}**`)
  lines.push(`- agent-transport-failures 行：**${report.transportFailures.length}**`)
  lines.push('')
  lines.push('## incident 层级分布')
  for (const [layer, count] of Object.entries(report.layerCounts)) {
    lines.push(`- ${layer}：**${count}**`)
  }
  lines.push('')
  lines.push('## agent-transport-failures 摘要')
  const byReason = new Map<string, number>()
  let emptyRid = 0
  for (const row of report.transportFailures) {
    byReason.set(row.reasonType, (byReason.get(row.reasonType) ?? 0) + 1)
    if (!row.requestId) {
      emptyRid += 1
    }
  }
  if (report.transportFailures.length === 0) {
    lines.push('_窗口内无记录_')
  } else {
    for (const [reason, count] of byReason.entries()) {
      lines.push(`- ${reason || 'unknown'}：**${count}**`)
    }
    lines.push(`- 空 requestId（诊断噪声）：**${emptyRid}**`)
  }
  lines.push('')
  lines.push('## incident 时间线（Sparkle 日志）')
  if (report.incidents.length === 0) {
    lines.push('_无_')
  } else {
    for (const incident of report.incidents.slice(0, limit)) {
      lines.push(`### ${formatLocal(incident.tsMs)} · ${incident.primaryLayer} · ${incident.confidence}`)
      lines.push(`- 机制：${incident.mechanisms.join(', ')}`)
      lines.push(`- 证据：\`${(incident.signals[0]?.evidence ?? '').slice(0, 200).replace(/\s+/g, ' ')}\``)
      lines.push('')
    }
    if (report.incidents.length > limit) {
      lines.push(`_… 另有 ${report.incidents.length - limit} 条，加 \`--full\`_`)
    }
  }
  lines.push('')
  lines.push('## 说明')
  lines.push('- **本报告只读 Sparkle/mihomo 日志**，不读 Cursor Structured Logs / renderer')
  lines.push('- 用户可见断连定责请用 triage 脚本（按需、非运行时耦合）')
  lines.push('')
  return lines.join('\n')
}
