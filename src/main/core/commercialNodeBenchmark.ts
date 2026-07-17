import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { homeDir } from '../utils/dirs'
import {
  CURSOR_PROBE_SLOW_MS,
  RECENT_SESSION_WINDOW_MS,
  RECENT_SLOW_WINDOW_MS,
  MIN_RECENT_SESSION_OBSERVATIONS,
  SLOW500_PENALTY_WEIGHT
} from './nodeQualityScore'
import {
  buildNodeTransportStats,
  buildStats,
  deriveNodeRankingStats,
  formatDetailedRow,
  MIN_RANK_SAMPLES,
  type DerivedStats,
  type NodeStats
} from './nodeProbeStats'
import { deriveCursorStability } from './cursorNodeStability'
import { showNotification } from '../utils/notification'
import {
  API2_PROBE_LEDGER_PATH,
  ensureApi2ProbeLedgerDir,
  ledgerRowToBenchmarkSample,
  pruneApi2ProbeLedger,
  readApi2ProbeLedgerSince
} from './api2ProbeLedgerCore'

const BENCHMARK_DIR = path.join(homeDir, '.sparkle')
const AGENT_FAILURES_PATH = path.join(BENCHMARK_DIR, 'agent-transport-failures.jsonl')
const REPORT_FILENAME = 'cursor-node-quality-report.md'
const RETENTION_MS = 24 * 60 * 60 * 1000
const CURSOR_PROBE_URL = 'https://api2.cursor.sh'

type NodeKind = 'vps' | 'commercial'

interface BenchmarkSample {
  ts: string
  node: string
  region: string
  kind: NodeKind
  delay_ms: number
  ok: boolean
}

interface BenchmarkConfig {
  enabled: boolean
  reportIntervalSec: number
  notifyOnReport: boolean
  reportDir: string
  reportPath: string
}

let reportTimer: NodeJS.Timeout | null = null
let isRunning = false

function resolveReportDir(rawDir: string | undefined): string {
  const trimmed = rawDir?.trim()
  return trimmed ? trimmed : BENCHMARK_DIR
}

export async function resolveCommercialBenchmarkConfig(): Promise<BenchmarkConfig> {
  const cfg = await getAppConfig()
  const reportDir = resolveReportDir(cfg.commercialNodeBenchmarkReportDir)
  return {
    enabled: cfg.commercialNodeBenchmarkEnabled === true,
    reportIntervalSec: cfg.commercialNodeBenchmarkReportIntervalSec ?? 3600,
    notifyOnReport: cfg.commercialNodeBenchmarkNotifyOnReport !== false,
    reportDir,
    reportPath: path.join(reportDir, REPORT_FILENAME)
  }
}

async function ensureReportDir(reportDir: string): Promise<void> {
  await mkdir(reportDir, { recursive: true })
}

async function ensureBenchmarkDir(): Promise<void> {
  await mkdir(BENCHMARK_DIR, { recursive: true })
  await ensureApi2ProbeLedgerDir()
}

async function resolveProbeActive(): Promise<boolean> {
  const config = await resolveCommercialBenchmarkConfig()
  return config.enabled
}

export async function syncCursorNodeReportScheduler(): Promise<void> {
  const config = await resolveCommercialBenchmarkConfig()
  const shouldSchedule = config.enabled

  if (!shouldSchedule) {
    if (reportTimer) {
      clearInterval(reportTimer)
      reportTimer = null
    }
    return
  }

  if (reportTimer) return

  reportTimer = setInterval(() => {
    void generateCommercialNodeReport({
      notify: config.notifyOnReport && config.enabled
    })
  }, config.reportIntervalSec * 1000)
}

interface RankingBundle {
  samples: BenchmarkSample[]
  allStats: NodeStats[]
  derived: DerivedStats[]
  ranked: DerivedStats[]
  byLatency: DerivedStats[]
  vpsRanked: DerivedStats[]
  commercialRanked: DerivedStats[]
}

function toStabilityEntry(d: DerivedStats, rank: number): CommercialNodeStabilityEntry {
  const cursor = deriveCursorStability({
    samples: d.stats.samples,
    successRate: d.successRate,
    jitter: d.jitter,
    slow500Rate: d.slow500Rate,
    eligibleForBadge: d.eligibleForBadge,
    transportFailures: d.transportFailures
  })

  return {
    node: d.stats.node,
    kind: d.stats.kind,
    region: d.stats.region,
    rank,
    combinedScore: d.combinedScore,
    stabilityScore: d.probeScore,
    probeScore: d.probeScore,
    sessionScore: d.sessionScore,
    sessionScore24h: d.sessionScore24h,
    sessionScore2h: d.sessionScore2h,
    sessionScoreSource: d.sessionScoreSource,
    sessionObservations2h: d.sessionObservations2h,
    p50: d.p50,
    successRate: d.successRate,
    slow500Rate: d.slow500Rate,
    jitter: d.jitter,
    eligibleForBadge: d.eligibleForBadge,
    badgeBlockReason: d.badgeBlockReason,
    cursorStability: cursor.level,
    cursorStabilityLabel: cursor.label,
    cursorStabilityHint: cursor.hint,
    transportFailures: d.transportFailures
  }
}

function buildStabilitySnapshot(
  bundle: RankingBundle,
  enabled: boolean,
  updatedAt: string
): CommercialNodeStabilitySnapshot {
  const topStable: CommercialNodeStabilityEntry[] = []
  const topVps = bundle.vpsRanked.find((entry) => entry.eligibleForBadge)
  if (topVps) {
    topStable.push(toStabilityEntry(topVps, 1))
  }
  const markersByNode: Record<string, CommercialNodeStabilityEntry> = {}
  for (const entry of topStable) {
    markersByNode[entry.node] = entry
  }
  const scoresByNode: Record<string, CommercialNodeStabilityEntry> = {}
  for (const entry of bundle.derived) {
    if (entry.stats.kind !== 'vps') continue
    if (entry.stats.samples < MIN_RANK_SAMPLES) continue
    scoresByNode[entry.stats.node] = toStabilityEntry(entry, 0)
  }
  return {
    updatedAt,
    enabled,
    minSamples: MIN_RANK_SAMPLES,
    topStable,
    markersByNode,
    scoresByNode
  }
}

async function buildRankingBundle(): Promise<RankingBundle> {
  await ensureBenchmarkDir()
  const cutoff = Date.now() - RETENTION_MS
  const ledgerRows = await readApi2ProbeLedgerSince(cutoff, 'vps')
  const samples = ledgerRows
    .filter((row) => row.kind === 'vps' || row.kind === undefined)
    .map(ledgerRowToBenchmarkSample)

  const statsMap = buildStats(samples, RECENT_SLOW_WINDOW_MS)
  const transportByNode24h = buildNodeTransportStats(AGENT_FAILURES_PATH, cutoff)
  const transportByNode2h = buildNodeTransportStats(
    AGENT_FAILURES_PATH,
    Date.now() - RECENT_SESSION_WINDOW_MS
  )
  const allStats = [...statsMap.values()]
  const derived = allStats
    .map((stats) =>
      deriveNodeRankingStats(
        stats,
        transportByNode24h.get(stats.node),
        transportByNode2h.get(stats.node)
      )
    )
    .filter((entry): entry is DerivedStats => entry !== null)

  const rankable = derived.filter(
    (entry) => entry.stats.samples >= MIN_RANK_SAMPLES && !entry.disqualified
  )

  const ranked = [...rankable].sort((a, b) => b.combinedScore - a.combinedScore)

  const byLatency = [...derived]
    .filter((entry) => entry.stats.delays.length >= 5 && !entry.disqualified)
    .sort((a, b) => a.p50 - b.p50)

  const vpsRanked = [...rankable]
    .filter((entry) => entry.stats.kind === 'vps')
    .sort((a, b) => b.combinedScore - a.combinedScore)

  const commercialRanked = [...rankable]
    .filter((entry) => entry.stats.kind === 'commercial')
    .sort((a, b) => b.combinedScore - a.combinedScore)

  return { samples, allStats, derived, ranked, byLatency, vpsRanked, commercialRanked }
}

let cachedStabilitySnapshot: CommercialNodeStabilitySnapshot | null = null
let cachedStabilityAtMs = 0
const STABILITY_SNAPSHOT_CACHE_MS = 60_000

function storeStabilitySnapshot(snapshot: CommercialNodeStabilitySnapshot): void {
  cachedStabilitySnapshot = snapshot
  cachedStabilityAtMs = Date.now()
}

export async function getCommercialNodeStabilityMarkers(): Promise<CommercialNodeStabilitySnapshot> {
  const probeActive = await resolveProbeActive()
  if (!probeActive) {
    return {
      updatedAt: new Date().toISOString(),
      enabled: false,
      minSamples: MIN_RANK_SAMPLES,
      topStable: [],
      markersByNode: {},
      scoresByNode: {}
    }
  }
  if (
    cachedStabilitySnapshot &&
    Date.now() - cachedStabilityAtMs < STABILITY_SNAPSHOT_CACHE_MS
  ) {
    return cachedStabilitySnapshot
  }
  const bundle = await buildRankingBundle()
  const snapshot = buildStabilitySnapshot(bundle, probeActive, new Date().toISOString())
  storeStabilitySnapshot(snapshot)
  return snapshot
}

export async function generateCommercialNodeReport(options?: {
  notify?: boolean
}): Promise<string> {
  const bundle = await buildRankingBundle()
  const { samples, allStats, derived, vpsRanked } = bundle
  const vpsStats = allStats.filter((s) => s.kind === 'vps')
  const vpsDerived = derived.filter((entry) => entry.stats.kind === 'vps')
  const vpsRankedByScore = [...vpsRanked]
  const vpsByLatency = [...vpsDerived]
    .filter((entry) => entry.stats.delays.length >= 5 && !entry.disqualified)
    .sort((a, b) => a.p50 - b.p50)
  const minSamples = MIN_RANK_SAMPLES

  const generatedAt = new Date().toISOString()
  const probeActive = await resolveProbeActive()
  const snapshot = buildStabilitySnapshot(bundle, probeActive, generatedAt)
  storeStabilitySnapshot(snapshot)
  const lines: string[] = [
    '# Cursor VPS Node Benchmark (24h)',
    '',
    `Generated: ${generatedAt}`,
    `Probe target: ${CURSOR_PROBE_URL}`,
    `Window: rolling 24h | Min samples for ranking: ${minSamples}`,
    `Samples in window: ${samples.length} | VPS nodes tracked: ${vpsStats.length}`,
    `Commercial probe: **off** (legacy commercial jsonl rows ignored in ranking)`,
    '',
    '## Executive Summary',
    ''
  ]

  if (vpsRanked.length > 0) {
    const bestVps = [...vpsRanked].sort((a, b) => a.p50 - b.p50)[0]
    const stableVps = vpsRanked.find((entry) => entry.eligibleForBadge) ?? vpsRanked[0]
    lines.push(
      `- **最快 (P50)**: ${bestVps.stats.node} — P50 ${Math.round(bestVps.p50)}ms, σ ${bestVps.stdev.toFixed(1)}ms, success ${(bestVps.successRate * 100).toFixed(1)}%`,
      `- **推荐 (combined)**: ${stableVps.stats.node} — combined ${stableVps.combinedScore.toFixed(1)}, probe ${stableVps.probeScore.toFixed(1)}, P50 ${Math.round(stableVps.p50)}ms, jitter ${Math.round(stableVps.jitter)}ms, slow>${CURSOR_PROBE_SLOW_MS}ms ${(stableVps.slow500Rate * 100).toFixed(1)}%${stableVps.eligibleForBadge ? '' : ` (badge blocked: ${stableVps.badgeBlockReason ?? 'gate'})`}`
    )
  } else {
    lines.push('- **推荐**: 暂无合格 VPS 节点（success/slow/jitter gate 未通过）')
  }
  lines.push('', '## Top Ranked VPS (>=10 samples, combined score)', '')
  lines.push(
    `_combined = probe score (success − avg/100 − slow>${CURSOR_PROBE_SLOW_MS} rate×${SLOW500_PENALTY_WEIGHT} − jitter×0.05 − recent_slow_extra) + session score (2h when ≥${MIN_RECENT_SESSION_OBSERVATIONS} session obs, else 24h: − agent_RST×2)_`,
    `_badge gate: success≥95%, slow>${CURSOR_PROBE_SLOW_MS}ms≤15%, jitter≤150ms_`,
    ''
  )

  if (vpsRankedByScore.length === 0) {
    lines.push('_Not enough VPS samples yet — wait for at least 10 minutes of probing._', '')
  } else {
    for (const [index, entry] of vpsRankedByScore.slice(0, 12).entries()) {
      const failPart =
        entry.transportFailures > 0 ? `, agentRST ${entry.transportFailures}` : ''
      const slowPart =
        entry.slow500Rate > 0
          ? `, slow>${CURSOR_PROBE_SLOW_MS}ms ${(entry.slow500Rate * 100).toFixed(1)}% (−${entry.slow500Penalty.toFixed(1)})`
          : ''
      const recentPart =
        entry.slow500RateRecent > 0
          ? `, slow2h ${(entry.slow500RateRecent * 100).toFixed(1)}%`
          : ''
      const badgePart = entry.eligibleForBadge ? '' : `, badge✗ ${entry.badgeBlockReason ?? 'gate'}`
      lines.push(
        `${index + 1}. **${entry.stats.node}** (${entry.stats.region}) — combined ${entry.combinedScore.toFixed(1)}, probe ${entry.probeScore.toFixed(1)}, P50 ${Math.round(entry.p50)}ms${failPart}${slowPart}${recentPart}${badgePart}`
      )
    }
    lines.push('')
  }

  lines.push('## Lowest Latency VPS (P50, >=5 successful samples)', '')
  if (vpsByLatency.length === 0) {
    lines.push('_Not enough successful VPS samples yet._', '')
  } else {
    for (const [index, entry] of vpsByLatency.slice(0, 12).entries()) {
      lines.push(
        `${index + 1}. **${entry.stats.node}** — P50 ${Math.round(entry.p50)}ms, avg ${Math.round(entry.avg)}ms, success ${(entry.successRate * 100).toFixed(1)}%`
      )
    }
    lines.push('')
  }

  lines.push(
    '## Full Comparison (VPS)',
    '',
    '| Kind | Region | Node | N | Success | Min | P50 | Avg | P90 | P95 | Max | σ | Jitter | CV% |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  )
  for (const d of [...vpsDerived].sort((a, b) => a.p50 - b.p50)) {
    lines.push(formatDetailedRow(d, 'VPS'))
  }
  lines.push(
    '',
    '## Metrics',
    '',
    '- **P50/P90/P95**: latency percentiles to api2.cursor.sh (mihomo delay API)',
    '- **σ (stdev)**: spread of successful probes; lower = more consistent',
    '- **active_probe**: Sparkle api2 transport probe every 60s on current Cursor node (scope=active ledger)',
    '- **agentRST**: ECONNRESET failures from Cursor agent (500 Guard + patch-99); ranking uses actual counts only',
    '- **probe score**: success×100 − avg/100 − slow500 penalty − jitter×0.05 − recent slow spike extra',
    `- **session score**: 2h window when ≥${MIN_RECENT_SESSION_OBSERVATIONS} session obs (agent RST), else 24h; − agent RST×2`,
    `- **slow>${CURSOR_PROBE_SLOW_MS}ms**: share of successful probes above ${CURSOR_PROBE_SLOW_MS}ms; penalty = rate×${SLOW500_PENALTY_WEIGHT}`,
    '- **combined score**: probe score + session score',
    '- **badge gate**: success≥95%, slow>500ms≤15%, jitter≤150ms — otherwise no UI badge',
    '- **Jitter**: P95 − P50; tail latency risk for long SSE sessions',
    '- **CV%**: coefficient of variation (σ/mean); normalized stability',
    '- **VPS ranking**: scope=vps ledger rows from SSH L4 probe (kr-vps/jp-vps every 300s)',
    ''
  )

  const config = await resolveCommercialBenchmarkConfig()
  const report = lines.join('\n')
  await ensureReportDir(config.reportDir)
  await writeFile(config.reportPath, report, 'utf8')
  appendAppLog(
    `[CommercialBenchmark]: report written (${vpsStats.length} VPS nodes) → ${config.reportPath}\n`
  )

  const shouldNotify = options?.notify ?? config.notifyOnReport
  if (shouldNotify && vpsRankedByScore.length > 0) {
    const best = vpsRankedByScore[0]
    const fastest = vpsByLatency[0]
    const bodyParts = [`推荐 VPS: ${best.stats.node} (P50 ${Math.round(best.p50)}ms)`]
    if (fastest) {
      bodyParts.push(`最低P50: ${fastest.stats.node} (${Math.round(fastest.p50)}ms)`)
    }
    bodyParts.push(`报告: ${config.reportPath}`)
    await showNotification({
      id: 'sparkle-commercial-benchmark-report',
      title: 'Cursor VPS 节点 24h 探测报告',
      body: bodyParts.join('\n'),
      variant: 'default'
    })
  }

  return report
}

export async function startCommercialNodeBenchmark(): Promise<void> {
  const config = await resolveCommercialBenchmarkConfig()
  if (!config.enabled) return
  if (isRunning) return

  isRunning = true
  await ensureBenchmarkDir()
  await pruneApi2ProbeLedger()

  appendAppLog(
    `[CommercialBenchmark]: reports ON (ledger=${API2_PROBE_LEDGER_PATH}, report=${config.reportIntervalSec}s, reportDir=${config.reportDir})\n`
  )

  await syncCursorNodeReportScheduler()

  void generateCommercialNodeReport({ notify: false })
}

export function stopCommercialNodeBenchmark(): void {
  isRunning = false
  cachedStabilitySnapshot = null
  cachedStabilityAtMs = 0
  appendAppLog('[CommercialBenchmark]: stopped\n')
  void syncCursorNodeReportScheduler()
}

export async function restartCommercialNodeBenchmark(): Promise<void> {
  stopCommercialNodeBenchmark()
  await startCommercialNodeBenchmark()
}

export async function getCommercialNodeReportPath(): Promise<string> {
  const config = await resolveCommercialBenchmarkConfig()
  return config.reportPath
}
