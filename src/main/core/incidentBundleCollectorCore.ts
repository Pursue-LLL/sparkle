// [INPUT] agent-transport rows · sparkle log paths · marathon segment cache
// [OUTPUT] collectIncidentBundleAtDisconnect
// [POS] P25c — A-moment evidence bundle without VPS SSH (marathon-safe).

import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface IncidentBundleInput {
  originalRequestId: string
  tsMs: number
  reasonSub?: string
  outBaseDir?: string
}

export interface IncidentBundleResult {
  bundleDir: string
  filesWritten: number
}

const PULSE_LOOKBACK_MS = 3_600_000

function sparkleHome(): string {
  return join(homedir(), '.sparkle')
}

function sparkleLogDir(): string {
  return join(homedir(), 'Library/Application Support/sparkle/logs')
}

function formatBundleDirName(originalRequestId: string, tsMs: number): string {
  const prefix = originalRequestId.split('-')[0] ?? 'unknown'
  const stamp = new Date(tsMs).toISOString().replace(/[:.]/g, '').slice(0, 15)
  return `cursor-incident-${prefix}-${stamp}`
}

async function readJsonlRowsMatching(
  filePath: string,
  needle: string,
): Promise<string[]> {
  if (!existsSync(filePath)) {
    return []
  }
  const text = await readFile(filePath, 'utf8')
  return text
    .split('\n')
    .filter((line) => line.includes(needle))
}

async function collectPulseGapStats(tsMs: number): Promise<string> {
  const logDir = sparkleLogDir()
  if (!existsSync(logDir)) {
    return 'log_dir_missing'
  }
  const files = (await readdir(logDir))
    .filter((name) => name.startsWith('app-') && name.endsWith('.log'))
    .map((name) => join(logDir, name))
  const sinceMs = tsMs - PULSE_LOOKBACK_MS
  const pulseLines: string[] = []
  const breachLines: string[] = []
  for (const filePath of files) {
    const text = await readFile(filePath, 'utf8')
    for (const line of text.split('\n')) {
      if (!line.includes('marathon_connect_path_pulse') && !line.includes('pulse_contract_breach')) {
        continue
      }
      const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/)
      if (tsMatch) {
        const lineMs = Date.parse(tsMatch[1])
        if (Number.isFinite(lineMs) && lineMs < sinceMs) {
          continue
        }
      }
      if (line.includes('pulse_contract_breach')) {
        breachLines.push(line)
      } else if (line.includes('marathon_connect_path_pulse')) {
        pulseLines.push(line)
      }
    }
  }
  const lines = [
    `# pulse-gap-stats tsMs=${tsMs}`,
    `pulse_executed=${pulseLines.filter((l) => l.includes('outcome=executed')).length}`,
    `pulse_skipped=${pulseLines.filter((l) => l.includes('outcome=skipped')).length}`,
    `pulse_contract_breach=${breachLines.length}`,
    '',
    '## last 10 pulse lines',
    ...pulseLines.slice(-10),
    '',
    '## breach lines',
    ...breachLines.slice(-5),
  ]
  return lines.join('\n')
}

export async function collectIncidentBundleAtDisconnect(
  input: IncidentBundleInput,
): Promise<IncidentBundleResult> {
  const outBase = input.outBaseDir ?? join(homedir(), 'Desktop')
  const bundleDir = join(outBase, formatBundleDirName(input.originalRequestId, input.tsMs))
  await mkdir(bundleDir, { recursive: true })
  let filesWritten = 0

  const writeText = async (name: string, content: string): Promise<void> => {
    if (!content.trim()) {
      return
    }
    await writeFile(
      join(bundleDir, name),
      content.endsWith('\n') ? content : `${content}\n`,
      'utf8',
    )
    filesWritten += 1
  }

  const rid = input.originalRequestId
  const transportRows = await readJsonlRowsMatching(
    join(sparkleHome(), 'agent-transport-failures.jsonl'),
    rid,
  )
  await writeText('sparkle-agent-transport-by-rid.jsonl', transportRows.join('\n'))

  const ledgerPath = join(sparkleHome(), 'api2-probe-ledger.jsonl')
  if (existsSync(ledgerPath)) {
    const ledgerText = await readFile(ledgerPath, 'utf8')
    const ledgerTail = ledgerText.split('\n').filter(Boolean).slice(-40)
    await writeText('sparkle-ledger-tail.jsonl', ledgerTail.join('\n'))
  }

  await writeText('pulse-gap-stats.txt', await collectPulseGapStats(input.tsMs))

  const segmentCache = join(sparkleHome(), 'marathon-segments.v1.jsonl')
  if (existsSync(segmentCache)) {
    const segmentRows = await readJsonlRowsMatching(segmentCache, rid)
    await writeText('marathon-segments-by-rid.jsonl', segmentRows.join('\n'))
  }

  await writeText(
    'incident-meta.json',
    JSON.stringify(
      {
        originalRequestId: rid,
        tsMs: input.tsMs,
        reasonSub: input.reasonSub ?? '',
        collectedAtMs: Date.now(),
      },
      null,
      2,
    ),
  )

  return { bundleDir, filesWritten }
}
