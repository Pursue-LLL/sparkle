#!/usr/bin/env tsx
// [INPUT] Sparkle logs only — no Cursor application logs
// [OUTPUT] Sparkle-only conservation markdown
// [POS] Default stability report after Cursor decoupling

import { execSync } from 'node:child_process'
import { join } from 'node:path'
import {
  dedupeAttributionSignals,
  formatAttributionReport,
  clusterAttributionSignals,
  resolveSparkleDataHome,
  scanSparkleLogsForSignals,
} from './marathonStabilityAttributionCore'
import { sparkleLogBundle } from './marathonStabilityLogPathsCore'
import {
  buildSparkleConservationReport,
  formatSparkleConservationReport,
  scanAgentTransportFailures,
} from './marathonStabilitySparkleConservationCore'

function parseHoursArg(argv: string[]): number {
  const idx = argv.indexOf('--hours')
  if (idx >= 0 && argv[idx + 1]) {
    const parsed = Number(argv[idx + 1])
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return 24
}

function hasFullFlag(argv: string[]): boolean {
  return argv.includes('--full')
}

function detectSparkleHealthy(): boolean {
  try {
    const out = execSync('pgrep -lf "Sparkle.app|mihomo"', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim().length > 0
  } catch {
    return false
  }
}

function main(): void {
  const argv = process.argv.slice(2)
  const hours = parseHoursArg(argv)
  const full = hasFullFlag(argv)
  const untilMs = Date.now()
  const sinceMs = untilMs - hours * 60 * 60 * 1000

  const dataHome = resolveSparkleDataHome()
  const bundle = sparkleLogBundle(dataHome)
  const transportPath = join(bundle.stateDir, 'agent-transport-failures.jsonl')

  const { signals, stats, linesScanned } = scanSparkleLogsForSignals({
    corePaths: bundle.corePaths,
    appPaths: bundle.appPaths,
    stabilityPath: bundle.stabilityPath,
    sinceMs,
    untilMs,
  })
  stats.sparkleProcessHealthy = detectSparkleHealthy()

  if (linesScanned === 0) {
    process.stderr.write(`error: zero sparkle log lines (dataHome=${dataHome})\n`)
    process.exit(2)
  }

  const deduped = dedupeAttributionSignals(signals)
  const transportFailures = scanAgentTransportFailures(transportPath, sinceMs, untilMs)
  const report = buildSparkleConservationReport({
    sinceMs,
    untilMs,
    signals: deduped,
    transportFailures,
  })

  process.stdout.write(
    formatSparkleConservationReport(report, {
      dataHome,
      coreFileCount: bundle.corePaths.length,
      appFileCount: bundle.appPaths.length,
      linesScanned,
      matrixLimit: full ? report.incidents.length : 8,
    }),
  )

  if (full) {
    process.stdout.write('\n---\n\n')
    process.stdout.write(formatAttributionReport(clusterAttributionSignals(deduped), { sinceMs, untilMs, stats }))
  }
}

main()
