/**
 * [INPUT]
 * - nodeQualityScore (POS: 纯函数 Cursor 节点质量评分)
 * - BenchmarkSample / NodeStats 由 commercialNodeBenchmark 写入
 *
 * [OUTPUT]
 * - buildStats / buildNodeTransportStats / deriveNodeRankingStats: 24h 探测聚合与评分
 *
 * [POS]
 * 节点探测样本聚合层。将 jsonl 样本与 session 观测转为排名用 DerivedStats。
 */

import { readFileSync } from 'fs'
import {
  computeProbeMetrics,
  MIN_RANK_SAMPLES,
  scoreNodeQuality,
  type NodeTransportObservations
} from './nodeQualityScore'

export interface NodeStats {
  node: string
  region: string
  kind: 'vps' | 'commercial'
  samples: number
  successes: number
  delays: number[]
  recentDelays: number[]
}

export interface NodeTransportStats {
  longProbeTotal: number
  longProbeOk: number
  transportFailures: number
  marathon15mCaps: number
}

export interface DerivedStats {
  stats: NodeStats
  successRate: number
  avg: number
  p50: number
  p90: number
  p95: number
  min: number
  max: number
  stdev: number
  jitter: number
  cv: number
  probeScore: number
  sessionScore: number
  sessionScore24h: number
  sessionScore2h: number | null
  sessionScoreSource: '2h' | '24h'
  sessionObservations2h: number
  slow500Rate: number
  slow500RateRecent: number
  slow500Penalty: number
  jitterPenalty: number
  recentSlowPenalty: number
  longProbeSuccessRate: number | null
  longProbeTotal: number
  longProbeOk: number
  transportFailures: number
  marathon15mCaps: number
  longProbeBonus: number
  combinedScore: number
  eligibleForBadge: boolean
  badgeBlockReason?: string
  disqualified: boolean
  disqualifyReason?: string
}

function readJsonlSince<T extends { ts?: string | number }>(
  filePath: string,
  sinceMs: number
): T[] {
  try {
    const raw = readFileSync(filePath, 'utf8')
    return raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as T)
      .filter((row) => {
        const tsRaw = row.ts
        const ts =
          typeof tsRaw === 'number' ? tsRaw : Date.parse(String(tsRaw ?? ''))
        return Number.isFinite(ts) && ts >= sinceMs
      })
  } catch {
    return []
  }
}

function emptyTransportStats(): NodeTransportStats {
  return {
    longProbeTotal: 0,
    longProbeOk: 0,
    transportFailures: 0,
    marathon15mCaps: 0
  }
}

export function buildNodeTransportStats(
  networkEventsPath: string,
  agentFailuresPath: string,
  sinceMs: number
): Map<string, NodeTransportStats> {
  const map = new Map<string, NodeTransportStats>()

  for (const row of readJsonlSince<{
    ts?: string
    kind?: string
    proxy_node?: string
    probe_ok?: boolean
    probe_hold_ms?: number
    probe_early_close?: boolean
    probe_welcome_only?: boolean
    probe_marathon_applicable?: boolean
    error_code?: string
  }>(networkEventsPath, sinceMs)) {
    if (!row.proxy_node) continue
    const cur = map.get(row.proxy_node) ?? emptyTransportStats()

    if (row.kind === 'long_probe') {
      if (row.probe_marathon_applicable === false || row.probe_welcome_only === true) {
        continue
      }
      const is15mCap =
        row.error_code === 'LONG_STREAM_15M_CAP' ||
        (row.probe_early_close === true &&
          typeof row.probe_hold_ms === 'number' &&
          row.probe_hold_ms >= 840_000 &&
          row.probe_hold_ms <= 960_000)
      map.set(row.proxy_node, {
        ...cur,
        longProbeTotal: cur.longProbeTotal + 1,
        longProbeOk: cur.longProbeOk + (row.probe_ok ? 1 : 0),
        marathon15mCaps: cur.marathon15mCaps + (is15mCap ? 1 : 0)
      })
    }
  }

  for (const row of readJsonlSince<{
    ts?: string | number
    proxyNode?: string
  }>(agentFailuresPath, sinceMs)) {
    const node = typeof row.proxyNode === 'string' ? row.proxyNode : ''
    if (!node) continue
    const cur = map.get(node) ?? emptyTransportStats()
    map.set(node, {
      ...cur,
      transportFailures: cur.transportFailures + 1
    })
  }

  return map
}

export function buildStats(
  samples: Array<{
    ts: string
    node: string
    region: string
    kind?: 'vps' | 'commercial'
    delay_ms: number
    ok: boolean
  }>,
  recentWindowMs: number
): Map<string, NodeStats> {
  const recentCutoff = Date.now() - recentWindowMs
  const stats = new Map<string, NodeStats>()
  for (const sample of samples) {
    const existing = stats.get(sample.node) ?? {
      node: sample.node,
      region: sample.region,
      kind: sample.kind ?? 'commercial',
      samples: 0,
      successes: 0,
      delays: [],
      recentDelays: []
    }
    existing.samples += 1
    if (sample.ok && sample.delay_ms > 0) {
      existing.successes += 1
      existing.delays.push(sample.delay_ms)
      const ts = Date.parse(sample.ts)
      if (Number.isFinite(ts) && ts >= recentCutoff) {
        existing.recentDelays.push(sample.delay_ms)
      }
    }
    stats.set(sample.node, existing)
  }
  return stats
}

function toTransportObservations(
  transport: NodeTransportStats | undefined
): NodeTransportObservations | undefined {
  if (!transport) return undefined
  return {
    longProbeTotal: transport.longProbeTotal,
    longProbeOk: transport.longProbeOk,
    transportFailures: transport.transportFailures,
    marathon15mCaps: transport.marathon15mCaps
  }
}

export function deriveNodeRankingStats(
  stats: NodeStats,
  transport24h?: NodeTransportStats,
  transport2h?: NodeTransportStats
): DerivedStats | null {
  const probe = computeProbeMetrics(
    stats.samples,
    stats.successes,
    stats.delays,
    stats.recentDelays
  )
  if (!probe) return null

  const quality = scoreNodeQuality(probe, {
    full: toTransportObservations(transport24h),
    recent: toTransportObservations(transport2h)
  })
  const stdev =
    stats.delays.length > 1
      ? Math.sqrt(
          stats.delays.reduce((sum, value) => sum + (value - probe.avg) ** 2, 0) /
            stats.delays.length
        )
      : 0
  const longProbeTotal = transport24h?.longProbeTotal ?? 0
  const longProbeOk = transport24h?.longProbeOk ?? 0
  const longProbeSuccessRate =
    longProbeTotal > 0 ? longProbeOk / longProbeTotal : null

  return {
    stats,
    successRate: probe.successRate,
    avg: probe.avg,
    p50: probe.p50,
    p90: probe.p90,
    p95: probe.p95,
    min: probe.min,
    max: probe.max,
    stdev,
    jitter: probe.jitter,
    cv: probe.cv,
    probeScore: quality.probeScore,
    sessionScore: quality.sessionScore,
    sessionScore24h: quality.sessionScore24h,
    sessionScore2h: quality.sessionScore2h,
    sessionScoreSource: quality.sessionScoreSource,
    sessionObservations2h: quality.sessionObservations2h,
    slow500Rate: probe.slow500Rate,
    slow500RateRecent: probe.slow500RateRecent,
    slow500Penalty: quality.slow500Penalty,
    jitterPenalty: quality.jitterPenalty,
    recentSlowPenalty: quality.recentSlowPenalty,
    longProbeSuccessRate,
    longProbeTotal,
    longProbeOk,
    transportFailures: transport24h?.transportFailures ?? 0,
    marathon15mCaps: transport24h?.marathon15mCaps ?? 0,
    longProbeBonus: quality.longProbeBonus,
    combinedScore: quality.combinedScore,
    eligibleForBadge: quality.eligibleForBadge,
    badgeBlockReason: quality.badgeBlockReason,
    disqualified: quality.disqualified,
    disqualifyReason: quality.disqualifyReason
  }
}

export function formatDetailedRow(d: DerivedStats, kindLabel: string): string {
  const s = d.stats
  return `| ${kindLabel} | ${s.region} | ${s.node} | ${s.samples} | ${(d.successRate * 100).toFixed(1)}% | ${Math.round(d.min)} | ${Math.round(d.p50)} | ${Math.round(d.avg)} | ${Math.round(d.p90)} | ${Math.round(d.p95)} | ${Math.round(d.max)} | ${d.stdev.toFixed(1)} | ${d.jitter >= 0 ? Math.round(d.jitter) : '-'} | ${d.cv >= 0 ? d.cv.toFixed(1) : '-'} |`
}

export { MIN_RANK_SAMPLES }
