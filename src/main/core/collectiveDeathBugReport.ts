// [INPUT] collectiveDeathBugReportCore · on-disk sparkle state
// [OUTPUT] buildCollectiveDeathBugReport · getLatestCollectiveDeathBugReportText
// [POS] Runtime collector + in-memory latest report cache for GUI copy.

import { existsSync } from 'fs'
import { readFile, readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { SPARKLE_BUILD_STAMP, SPARKLE_SEMVER } from '../../shared/buildStamp'
import {
  filterCollectiveDeathLogLines,
  formatCollectiveDeathBugReport,
  orderAppLogNamesNewestFirst,
  type CollectiveDeathBugReportContext,
  type CollectiveDeathTriggerKind,
} from './collectiveDeathBugReportCore'

export interface BuildCollectiveDeathBugReportInput {
  trigger: CollectiveDeathTriggerKind
  tsMs?: number
  cursorConnectionCount?: number
  leafId?: string
  evidenceReason?: string
  drainMs?: number
}

let latestReportText: string | null = null
let latestReportAtMs = 0

export function getLatestCollectiveDeathBugReportText(): string | null {
  return latestReportText
}

export function resetCollectiveDeathBugReportForTests(): void {
  latestReportText = null
  latestReportAtMs = 0
}

function sparkleLogDir(): string {
  return join(homedir(), 'Library/Application Support/sparkle/logs')
}

function sparkleStateDir(): string {
  return join(homedir(), '.sparkle')
}

async function readLatestAppLogLines(maxLines: number): Promise<string[]> {
  const logDir = sparkleLogDir()
  if (!existsSync(logDir)) {
    return []
  }
  const ordered = orderAppLogNamesNewestFirst(await readdir(logDir))
  const collected: string[] = []
  for (const name of ordered) {
    if (collected.length >= maxLines) {
      break
    }
    const text = await readFile(join(logDir, name), 'utf8')
    const need = maxLines - collected.length
    // Older day's tail must precede the newer lines already collected.
    collected.unshift(...text.split('\n').slice(-need))
  }
  return collected.slice(-maxLines)
}

async function readStabilityEventTail(maxRows: number): Promise<string[]> {
  const path = join(sparkleStateDir(), 'network-stability-events.jsonl')
  if (!existsSync(path)) {
    return []
  }
  const text = await readFile(path, 'utf8')
  return text.split('\n').filter(Boolean).slice(-maxRows)
}

async function readLongevitySnapshotJson(): Promise<string | undefined> {
  const path = join(sparkleStateDir(), 'transport-longevity-truth.json')
  if (!existsSync(path)) {
    return undefined
  }
  const raw = await readFile(path, 'utf8')
  try {
    const parsed = JSON.parse(raw) as unknown
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw.trim()
  }
}

export async function buildCollectiveDeathBugReport(
  input: BuildCollectiveDeathBugReportInput,
): Promise<string> {
  const tsMs = input.tsMs ?? Date.now()
  const rawLogLines = await readLatestAppLogLines(800)
  const context: CollectiveDeathBugReportContext = {
    trigger: input.trigger,
    tsMs,
    sparkleSemver: SPARKLE_SEMVER,
    sparkleBuildStamp: SPARKLE_BUILD_STAMP,
    cursorConnectionCount: input.cursorConnectionCount,
    leafId: input.leafId,
    evidenceReason: input.evidenceReason,
    drainMs: input.drainMs,
    logLines: filterCollectiveDeathLogLines(rawLogLines, tsMs),
    stabilityEventLines: await readStabilityEventTail(8),
    longevitySnapshotJson: await readLongevitySnapshotJson(),
  }
  const report = formatCollectiveDeathBugReport(context)
  latestReportText = report
  latestReportAtMs = tsMs
  return report
}

export function getLatestCollectiveDeathBugReportAgeMs(nowMs: number = Date.now()): number {
  if (latestReportAtMs <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return Math.max(0, nowMs - latestReportAtMs)
}
