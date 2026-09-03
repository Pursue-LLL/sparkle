// [INPUT] real home · sparkle log directories
// [OUTPUT] resolve paths · list log files
// [POS] Phase 0/0.5 — multi-file Sparkle log discovery only

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveSparkleDataHome } from './marathonStabilityAttributionCore'

export interface SparkleLogBundle {
  dataHome: string
  logDir: string
  stateDir: string
  corePaths: string[]
  appPaths: string[]
  stabilityPath: string
}

export function sparkleLogBundle(dataHome: string = resolveSparkleDataHome()): SparkleLogBundle {
  const logDir = join(dataHome, 'Library', 'Application Support', 'sparkle', 'logs')
  const stateDir = join(dataHome, '.sparkle')
  return {
    dataHome,
    logDir,
    stateDir,
    corePaths: listFilesByPrefix(logDir, 'core-'),
    appPaths: listFilesByPrefix(logDir, 'app-'),
    stabilityPath: join(stateDir, 'network-stability-events.jsonl'),
  }
}

function listFilesByPrefix(dir: string, prefix: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort()
    .map((name) => join(dir, name))
}

export function readTextFiles(paths: readonly string[]): string {
  const chunks: string[] = []
  for (const path of paths) {
    if (!path || !existsSync(path)) {
      continue
    }
    chunks.push(readFileSync(path, 'utf8'))
  }
  return chunks.join('\n')
}

export function countScannedLines(text: string): number {
  if (!text) {
    return 0
  }
  let count = 0
  for (const line of text.split('\n')) {
    if (line.trim()) {
      count += 1
    }
  }
  return count
}
