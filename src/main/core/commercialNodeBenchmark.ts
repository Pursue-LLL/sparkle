import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { homeDir } from '../utils/dirs'
import { mihomoProxies, mihomoProxyDelay } from './mihomoApi'
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
import {
  formatCommercialBenchmarkBurstSkipReason,
  shouldSkipCommercialBenchmarkDuringBurst
} from './networkBurstGateCore'
import { getNetworkBurstUntilMs } from './networkStabilityMonitor'
import { showNotification } from '../utils/notification'

const BENCHMARK_DIR = path.join(homeDir, '.sparkle')
const SAMPLES_PATH = path.join(BENCHMARK_DIR, 'commercial-node-benchmark.jsonl')
const NETWORK_EVENTS_PATH = path.join(BENCHMARK_DIR, 'network-stability-events.jsonl')
const AGENT_FAILURES_PATH = path.join(BENCHMARK_DIR, 'agent-transport-failures.jsonl')
const REPORT_FILENAME = 'commercial-node-report.md'
const RETENTION_MS = 24 * 60 * 60 * 1000
const CURSOR_PROBE_URL = 'https://api2.cursor.sh'

const INFO_NODE_PATTERNS = [
  /剩余流量/u,
  /套餐到期/u,
  /距离下次/u,
  /重置剩余/u,
  /官网/u,
  /邮件/u,
  /注意[:：]/u,
  /不推荐/u,
  /test\s*0\.1/i,
  /Hysteria2 test/i
]

const VPS_NODE_PATTERNS = [/VPS/i, /自建/i, /c7sg/i]

const NON_ROUTING_PROXY_NAMES = new Set([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'DNS',
  'NOOP',
  'GLOBAL'
])

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
  intervalSec: number
  reportIntervalSec: number
  concurrency: number
  regions: string[]
  includeVps: boolean
  notifyOnReport: boolean
  reportDir: string
  reportPath: string
}

let benchmarkTimer: NodeJS.Timeout | null = null
let reportTimer: NodeJS.Timeout | null = null
let isRunning = false
let isProbing = false
let appendCount = 0
let writeQueue: Promise<void> = Promise.resolve()

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

import {
  DEFAULT_REGION_PRIORITY,
  nodeMatchesRegion
} from './regionPriority'

function isVpsLeafNode(name: string): boolean {
  if (NON_ROUTING_PROXY_NAMES.has(name)) return false
  if (INFO_NODE_PATTERNS.some((pattern) => pattern.test(name))) return false
  return VPS_NODE_PATTERNS.some((pattern) => pattern.test(name))
}

function isCommercialLeafNode(name: string): boolean {
  if (NON_ROUTING_PROXY_NAMES.has(name)) return false
  if (INFO_NODE_PATTERNS.some((pattern) => pattern.test(name))) return false
  if (VPS_NODE_PATTERNS.some((pattern) => pattern.test(name))) return false
  return true
}

function resolveVpsRegion(nodeName: string): string {
  const lower = nodeName.toLowerCase()
  if (/kr|韩国/u.test(nodeName) || lower.includes('kr')) return 'KR-VPS'
  if (/jp|日本/u.test(nodeName) || lower.includes('jp')) return 'JP-VPS'
  if (/sg|新加坡|singapore/u.test(nodeName) || lower.includes('sg')) return 'SG-VPS'
  return 'VPS'
}

function resolveNodeRegion(nodeName: string, regions: string[]): string {
  if (isVpsLeafNode(nodeName)) return resolveVpsRegion(nodeName)
  for (const region of regions) {
    if (nodeMatchesRegion(nodeName, region)) return region
  }
  return 'other'
}

function resolveReportDir(rawDir: string | undefined): string {
  const trimmed = rawDir?.trim()
  return trimmed ? trimmed : BENCHMARK_DIR
}

export async function resolveCommercialBenchmarkConfig(): Promise<BenchmarkConfig> {
  const cfg = await getAppConfig()
  const reportDir = resolveReportDir(cfg.commercialNodeBenchmarkReportDir)
  return {
    enabled: cfg.commercialNodeBenchmarkEnabled === true,
    intervalSec: cfg.commercialNodeBenchmarkIntervalSec ?? 60,
    reportIntervalSec: cfg.commercialNodeBenchmarkReportIntervalSec ?? 3600,
    concurrency: cfg.commercialNodeBenchmarkConcurrency ?? 10,
    regions: cfg.commercialNodeBenchmarkRegions ?? [...DEFAULT_REGION_PRIORITY],
    includeVps: cfg.commercialNodeBenchmarkIncludeVps !== false,
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
}

export async function ensureCommercialBenchmarkStorage(): Promise<void> {
  await ensureBenchmarkDir()
}

export async function appendCommercialProbeSample(sample: BenchmarkSample): Promise<void> {
  await appendSample(sample)
}

export async function pruneCommercialProbeSamples(): Promise<void> {
  await pruneSamplesFile()
}

export async function probeLeafNodesWithCursorApi(
  nodes: Array<{ name: string; region: string; kind: NodeKind }>,
  concurrency: number
): Promise<void> {
  if (shouldSkipCommercialBenchmarkDuringBurst(getNetworkBurstUntilMs())) {
    appendAppLog(
      `[CommercialBenchmark]: skip manual probe — ${formatCommercialBenchmarkBurstSkipReason(getNetworkBurstUntilMs())}\n`
    )
    return
  }
  await probeNodesConcurrently(nodes, concurrency)
}

export async function refreshCommercialStabilityCache(): Promise<void> {
  const bundle = await buildRankingBundle()
  const snapshot = buildStabilitySnapshot(
    bundle,
    await resolveProbeActive(),
    new Date().toISOString()
  )
  storeStabilitySnapshot(snapshot)
}

async function appendSample(sample: BenchmarkSample): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await ensureBenchmarkDir()
    await appendFile(SAMPLES_PATH, `${JSON.stringify(sample)}\n`, 'utf8')
    appendCount += 1
    if (appendCount % 200 === 0) {
      await pruneSamplesFile()
    }
  })
  await writeQueue
}

async function pruneSamplesFile(): Promise<void> {
  try {
    const raw = await readFile(SAMPLES_PATH, 'utf8')
    if (!raw) return
    const cutoff = Date.now() - RETENTION_MS
    const kept = raw
      .split('\n')
      .filter((line) => {
        if (!line.trim()) return false
        try {
          const parsed = JSON.parse(line) as BenchmarkSample
          const ts = Date.parse(parsed.ts)
          return Number.isFinite(ts) && ts >= cutoff
        } catch {
          return false
        }
      })
    const nextContent = kept.length > 0 ? `${kept.join('\n')}\n` : ''
    await writeFile(SAMPLES_PATH, nextContent, 'utf8')
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code !== 'ENOENT') {
      appendAppLog(`[CommercialBenchmark]: prune failed: ${formatError(error)}\n`)
    }
  }
}

async function resolveProbeActive(): Promise<boolean> {
  const config = await resolveCommercialBenchmarkConfig()
  const { isVpsCursorProbeRunning } = await import('./vpsCursorProbe')
  return config.enabled || isVpsCursorProbeRunning()
}

export async function syncCursorNodeReportScheduler(): Promise<void> {
  const config = await resolveCommercialBenchmarkConfig()
  const { isVpsCursorProbeRunning } = await import('./vpsCursorProbe')
  const shouldSchedule = config.enabled || isVpsCursorProbeRunning()

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

async function listBenchmarkNodes(
  regions: string[],
  includeVps: boolean
): Promise<Array<{ name: string; region: string; kind: NodeKind }>> {
  const proxies = await mihomoProxies()
  const [{ isCanonicalVpsNodeName }, { isVpsCursorProbeRunning }] = await Promise.all([
    import('./vpsCanonicalNodes'),
    import('./vpsCursorProbe')
  ])
  const skipCanonicalForCommercial = isVpsCursorProbeRunning()
  const nodes: Array<{ name: string; region: string; kind: NodeKind }> = []
  for (const [name, entry] of Object.entries(proxies.proxies)) {
    if ('all' in entry) continue
    if (includeVps && isVpsLeafNode(name)) {
      if (skipCanonicalForCommercial && isCanonicalVpsNodeName(name)) {
        continue
      }
      nodes.push({ name, region: resolveVpsRegion(name), kind: 'vps' })
      continue
    }
    if (!isCommercialLeafNode(name)) continue
    const region = resolveNodeRegion(name, regions)
    if (region === 'other') continue
    nodes.push({ name, region, kind: 'commercial' })
  }
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'vps' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

async function probeNodesConcurrently(
  nodes: Array<{ name: string; region: string; kind: NodeKind }>,
  concurrency: number
): Promise<void> {
  const executing = new Set<Promise<void>>()

  for (const node of nodes) {
    const task = (async () => {
      const ts = new Date().toISOString()
      try {
        const result = await mihomoProxyDelay(node.name, CURSOR_PROBE_URL)
        const delay = result.delay ?? 0
        const ok = delay > 0
        await appendSample({
          ts,
          node: node.name,
          region: node.region,
          kind: node.kind,
          delay_ms: ok ? delay : -1,
          ok
        })
      } catch {
        await appendSample({
          ts,
          node: node.name,
          region: node.region,
          kind: node.kind,
          delay_ms: -1,
          ok: false
        })
      }
    })()

    executing.add(task)
    task.finally(() => executing.delete(task))

    if (executing.size >= concurrency) {
      await Promise.race(executing)
    }
  }

  await Promise.allSettled([...executing])
}

async function runBenchmarkCycle(): Promise<void> {
  if (!isRunning || isProbing) return
  if (shouldSkipCommercialBenchmarkDuringBurst(getNetworkBurstUntilMs())) {
    appendAppLog(
      `[CommercialBenchmark]: skip cycle — ${formatCommercialBenchmarkBurstSkipReason(getNetworkBurstUntilMs())}\n`
    )
    return
  }
  isProbing = true
  try {
    const config = await resolveCommercialBenchmarkConfig()
    if (!config.enabled) return

    const nodes = await listBenchmarkNodes(config.regions, config.includeVps)
    if (nodes.length === 0) {
      appendAppLog('[CommercialBenchmark]: no benchmark nodes matched (commercial/VPS)\n')
      return
    }

    const vpsN = nodes.filter((n) => n.kind === 'vps').length
    appendAppLog(
      `[CommercialBenchmark]: probing ${nodes.length} nodes (${vpsN} VPS + ${nodes.length - vpsN} commercial) via ${CURSOR_PROBE_URL}\n`
    )
    await probeNodesConcurrently(nodes, config.concurrency)
  } catch (error) {
    appendAppLog(`[CommercialBenchmark]: cycle error: ${formatError(error)}\n`)
  } finally {
    isProbing = false
  }
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
    transportFailures: d.transportFailures,
    marathon15mCaps: d.marathon15mCaps,
    longProbeTotal: d.longProbeTotal,
    longProbeSuccessRate: d.longProbeSuccessRate
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
    transportFailures: d.transportFailures,
    marathon15mCaps: d.marathon15mCaps,
    longProbeTotal: d.longProbeTotal,
    longProbeOk: d.longProbeOk,
    longProbeSuccessRate: d.longProbeSuccessRate
  }
}

function buildStabilitySnapshot(
  bundle: RankingBundle,
  enabled: boolean,
  updatedAt: string
): CommercialNodeStabilitySnapshot {
  const topStable: CommercialNodeStabilityEntry[] = []
  const topVps = bundle.vpsRanked.find((entry) => entry.eligibleForBadge)
  const topCommercial = bundle.commercialRanked.find((entry) => entry.eligibleForBadge)
  if (topVps) {
    topStable.push(toStabilityEntry(topVps, 1))
  }
  if (topCommercial) {
    topStable.push(toStabilityEntry(topCommercial, 1))
  }
  const markersByNode: Record<string, CommercialNodeStabilityEntry> = {}
  for (const entry of topStable) {
    markersByNode[entry.node] = entry
  }
  const scoresByNode: Record<string, CommercialNodeStabilityEntry> = {}
  for (const entry of bundle.derived) {
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
  let raw = ''
  try {
    raw = await readFile(SAMPLES_PATH, 'utf8')
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code !== 'ENOENT') throw error
  }

  const cutoff = Date.now() - RETENTION_MS
  const samples = raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as BenchmarkSample)
    .filter((sample) => {
      const ts = Date.parse(sample.ts)
      return Number.isFinite(ts) && ts >= cutoff
    })

  const statsMap = buildStats(samples, RECENT_SLOW_WINDOW_MS)
  const transportByNode24h = buildNodeTransportStats(
    NETWORK_EVENTS_PATH,
    AGENT_FAILURES_PATH,
    cutoff
  )
  const transportByNode2h = buildNodeTransportStats(
    NETWORK_EVENTS_PATH,
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
  const { samples, allStats, derived, ranked, byLatency, vpsRanked, commercialRanked } = bundle
  const minSamples = MIN_RANK_SAMPLES

  const generatedAt = new Date().toISOString()
  const probeActive = await resolveProbeActive()
  const snapshot = buildStabilitySnapshot(bundle, probeActive, generatedAt)
  storeStabilitySnapshot(snapshot)
  const lines: string[] = [
    '# Cursor Node Benchmark (24h) — VPS + Commercial',
    '',
    `Generated: ${generatedAt}`,
    `Probe target: ${CURSOR_PROBE_URL}`,
    `Window: rolling 24h | Sample interval: 60s | Min samples for ranking: ${minSamples}`,
    `Samples in window: ${samples.length} | Nodes tracked: ${allStats.length} (VPS ${allStats.filter((s) => s.kind === 'vps').length} + commercial ${allStats.filter((s) => s.kind === 'commercial').length})`,
    '',
    '## Executive Summary',
    ''
  ]

  if (vpsRanked.length > 0) {
    const bestVps = [...vpsRanked].sort((a, b) => a.p50 - b.p50)[0]
    const stableVps = vpsRanked.find((entry) => entry.eligibleForBadge) ?? vpsRanked[0]
    lines.push(
      `- **自建最快 (P50)**: ${bestVps.stats.node} — P50 ${Math.round(bestVps.p50)}ms, σ ${bestVps.stdev.toFixed(1)}ms, success ${(bestVps.successRate * 100).toFixed(1)}%`,
      `- **自建推荐 (combined)**: ${stableVps.stats.node} — combined ${stableVps.combinedScore.toFixed(1)}, probe ${stableVps.probeScore.toFixed(1)}, P50 ${Math.round(stableVps.p50)}ms, jitter ${Math.round(stableVps.jitter)}ms, slow>${CURSOR_PROBE_SLOW_MS}ms ${(stableVps.slow500Rate * 100).toFixed(1)}%${stableVps.eligibleForBadge ? '' : ` (badge blocked: ${stableVps.badgeBlockReason ?? 'gate'})`}`
    )
  } else {
    lines.push('- **自建推荐**: 暂无合格节点（success/slow/jitter gate 未通过）')
  }
  if (commercialRanked.length > 0) {
    const bestComm = [...commercialRanked].sort((a, b) => a.p50 - b.p50)[0]
    const stableComm = commercialRanked.find((entry) => entry.eligibleForBadge) ?? commercialRanked[0]
    lines.push(
      `- **商业最快 (P50)**: ${bestComm.stats.node} — P50 ${Math.round(bestComm.p50)}ms, σ ${bestComm.stdev.toFixed(1)}ms`,
      `- **商业推荐 (combined)**: ${stableComm.stats.node} — combined ${stableComm.combinedScore.toFixed(1)}, probe ${stableComm.probeScore.toFixed(1)}, P50 ${Math.round(stableComm.p50)}ms, slow>${CURSOR_PROBE_SLOW_MS}ms ${(stableComm.slow500Rate * 100).toFixed(1)}%${stableComm.eligibleForBadge ? '' : ` (badge blocked: ${stableComm.badgeBlockReason ?? 'gate'})`}`
    )
  } else {
    lines.push('- **商业推荐**: 暂无合格节点（success/slow/jitter gate 未通过）')
  }
  if (vpsRanked.length > 0 && commercialRanked.length > 0) {
    const bestVpsP50 = Math.min(...vpsRanked.map((d) => d.p50))
    const bestCommP50 = Math.min(...commercialRanked.map((d) => d.p50))
    const rec =
      bestVpsP50 <= bestCommP50
        ? `Cursor 组默认优先 **自建 VPS**（P50 领先 ${Math.round(bestCommP50 - bestVpsP50)}ms）`
        : `商业节点 P50 领先自建 ${Math.round(bestVpsP50 - bestCommP50)}ms，可 A/B 验证后切换`
    lines.push(`- **推荐**: ${rec}`)
  }
  lines.push('', '## Top Ranked (>=10 samples, combined score)', '')
  lines.push(
    `_combined = probe score (success − avg/100 − slow>${CURSOR_PROBE_SLOW_MS} rate×${SLOW500_PENALTY_WEIGHT} − jitter×0.05 − recent_slow_extra) + session score (2h when ≥${MIN_RECENT_SESSION_OBSERVATIONS} session obs, else 24h: long_probe_ok×5 − agent_RST×2 − 15m_cap×8)_`,
    `_badge gate: success≥95%, slow>${CURSOR_PROBE_SLOW_MS}ms≤15%, jitter≤150ms_`,
    ''
  )

  if (ranked.length === 0) {
    lines.push('_Not enough samples yet — wait for at least 10 minutes of probing._', '')
  } else {
    for (const [index, entry] of ranked.slice(0, 12).entries()) {
      const kindLabel = entry.stats.kind === 'vps' ? '自建' : '商业'
      const longPart =
        entry.longProbeSuccessRate !== null
          ? `, longSSE ${(entry.longProbeSuccessRate * 100).toFixed(0)}%`
          : ''
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
        `${index + 1}. **[${kindLabel}] ${entry.stats.node}** (${entry.stats.region}) — combined ${entry.combinedScore.toFixed(1)}, probe ${entry.probeScore.toFixed(1)}, P50 ${Math.round(entry.p50)}ms${longPart}${failPart}${slowPart}${recentPart}${badgePart}`
      )
    }
    lines.push('')
  }

  lines.push('## Lowest Latency (P50, >=5 successful samples)', '')
  if (byLatency.length === 0) {
    lines.push('_Not enough successful samples yet._', '')
  } else {
    for (const [index, entry] of byLatency.slice(0, 12).entries()) {
      const kindLabel = entry.stats.kind === 'vps' ? '自建' : '商业'
      lines.push(
        `${index + 1}. **[${kindLabel}] ${entry.stats.node}** — P50 ${Math.round(entry.p50)}ms, avg ${Math.round(entry.avg)}ms, success ${(entry.successRate * 100).toFixed(1)}%`
      )
    }
    lines.push('')
  }

  lines.push(
    '## Full Comparison',
    '',
    '| Kind | Region | Node | N | Success | Min | P50 | Avg | P90 | P95 | Max | σ | Jitter | CV% |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  )
  for (const d of [...derived].sort((a, b) => a.p50 - b.p50)) {
    const kindLabel = d.stats.kind === 'vps' ? '自建' : '商业'
    lines.push(formatDetailedRow(d, kindLabel))
  }
  lines.push(
    '',
    '## Metrics',
    '',
    '- **P50/P90/P95**: latency percentiles to api2.cursor.sh (mihomo delay API)',
    '- **σ (stdev)**: spread of successful probes; lower = more consistent',
    '- **long_probe**: Sparkle holds agent.api5.cursor.sh SSE up to 16min every 30min (detects ~15min stream caps)',
    '- **agentRST**: ECONNRESET failures from Cursor agent (500 Guard + patch-99); ranking uses actual counts only',
    '- **probe score**: success×100 − avg/100 − slow500 penalty − jitter×0.05 − recent slow spike extra',
    `- **session score**: 2h window when ≥${MIN_RECENT_SESSION_OBSERVATIONS} session obs (long_probe/RST/15m), else 24h; long SSE bonus − agent RST×2 − 15m cap×8`,
    `- **slow>${CURSOR_PROBE_SLOW_MS}ms**: share of successful probes above ${CURSOR_PROBE_SLOW_MS}ms; penalty = rate×${SLOW500_PENALTY_WEIGHT}`,
    '- **combined score**: probe score + session score',
    '- **badge gate**: success≥95%, slow>500ms≤15%, jitter≤150ms — otherwise no UI badge',
    '- **Jitter**: P95 − P50; tail latency risk for long SSE sessions',
    '- **CV%**: coefficient of variation (σ/mean); normalized stability',
    '- **自建 (VPS)**: HY2 leaf nodes from Sparkle override; **商业**: subscription SG/TW/JP',
    ''
  )

  const config = await resolveCommercialBenchmarkConfig()
  const report = lines.join('\n')
  await ensureReportDir(config.reportDir)
  await writeFile(config.reportPath, report, 'utf8')
  appendAppLog(
    `[CommercialBenchmark]: report written (${allStats.length} nodes) → ${config.reportPath}\n`
  )

  const shouldNotify = options?.notify ?? config.notifyOnReport
  if (shouldNotify && ranked.length > 0) {
    const best = ranked[0]
    const fastest = byLatency[0]
    const bodyParts = [
      `推荐: [${best.stats.kind === 'vps' ? '自建' : '商业'}] ${best.stats.node} (P50 ${Math.round(best.p50)}ms)`
    ]
    if (fastest) {
      bodyParts.push(
        `最低P50: [${fastest.stats.kind === 'vps' ? '自建' : '商业'}] ${fastest.stats.node} (${Math.round(fastest.p50)}ms)`
      )
    }
    bodyParts.push(`报告: ${config.reportPath}`)
    await showNotification({
      id: 'sparkle-commercial-benchmark-report',
      title: 'Cursor 节点 24h 探测报告 (VPS+商业)',
      body: bodyParts.join('\n'),
      variant: 'default'
    })
  }

  return report
}

function scheduleBenchmark(intervalSec: number): void {
  if (benchmarkTimer) clearInterval(benchmarkTimer)
  benchmarkTimer = setInterval(() => {
    void runBenchmarkCycle()
  }, intervalSec * 1000)
}

export async function startCommercialNodeBenchmark(): Promise<void> {
  const config = await resolveCommercialBenchmarkConfig()
  if (!config.enabled) return
  if (isRunning) return

  isRunning = true
  appendCount = 0
  await ensureBenchmarkDir()
  await pruneSamplesFile()

  appendAppLog(
    `[CommercialBenchmark]: started (interval=${config.intervalSec}s, report=${config.reportIntervalSec}s, reportDir=${config.reportDir}, includeVps=${config.includeVps}, nodes filter=${config.regions.join('/')})\n`
  )

  void runBenchmarkCycle()
  scheduleBenchmark(config.intervalSec)
  await syncCursorNodeReportScheduler()

  void generateCommercialNodeReport({ notify: false })
}

export function stopCommercialNodeBenchmark(): void {
  if (benchmarkTimer) {
    clearInterval(benchmarkTimer)
    benchmarkTimer = null
  }
  isRunning = false
  isProbing = false
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
