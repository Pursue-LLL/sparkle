#!/usr/bin/env tsx
// [INPUT] ~/Library/Application Support/sparkle/logs (all core/app files) · stability jsonl
// [OUTPUT] stdout markdown attribution report (Phase 0)
// [POS] CLI wrapper for marathonStabilityAttributionCore

import { execSync } from 'node:child_process'
import {
  clusterAttributionSignals,
  dedupeAttributionSignals,
  formatAttributionReport,
  resolveSparkleDataHome,
  scanSparkleLogsForSignals,
} from './marathonStabilityAttributionCore'
import { sparkleLogBundle } from './marathonStabilityLogPathsCore'

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
  const hours = parseHoursArg(process.argv.slice(2))
  const untilMs = Date.now()
  const sinceMs = untilMs - hours * 60 * 60 * 1000

  const dataHome = resolveSparkleDataHome()
  const bundle = sparkleLogBundle(dataHome)

  const { signals, stats, linesScanned } = scanSparkleLogsForSignals({
    corePaths: bundle.corePaths,
    appPaths: bundle.appPaths,
    stabilityPath: bundle.stabilityPath,
    sinceMs,
    untilMs,
  })
  stats.sparkleProcessHealthy = detectSparkleHealthy()

  if (linesScanned === 0) {
    process.stderr.write(`error: zero sparkle log lines under ${bundle.logDir}\n`)
    process.exit(2)
  }

  const deduped = dedupeAttributionSignals(signals)
  const incidents = clusterAttributionSignals(deduped)
  const report = formatAttributionReport(incidents, { sinceMs, untilMs, stats })

  process.stdout.write(`dataHome: \`${dataHome}\` · core=${bundle.corePaths.length} app=${bundle.appPaths.length}\n\n`)
  process.stdout.write(report)
}

main()
