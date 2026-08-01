// [INPUT] marathonSegmentCache · connectPartitionReader · maxStepsRateObserverCore
// [OUTPUT] logMaxStepsRateIfDue
// [POS] P28 hung_scan periodic max-steps achievement rate (observe-only, no Cursor behavior change).

import { appendFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { appendAppLog } from '../utils/log'
import { readAgentTransportJsonlTailRows } from './connectPartitionReader'
import {
  computeMaxStepsRateSnapshot,
  formatMaxStepsRateLogLine,
} from './maxStepsRateObserverCore'
import {
  computeStreamAttemptMaxStepsRateSnapshot,
  formatStreamAttemptMaxStepsRateLogSuffix,
} from './streamAttemptMaxStepsRateCore'
import { computePhysicalMaxStepsRateSnapshot } from './physicalMaxStepsRateCore'
import { readMarathonSegmentCache } from './marathonSegmentCache'
import { ingestValidatedLedgerTerminals } from './validatedLedgerTerminalIngest'

const LOG_COOLDOWN_MS = 300_000

let lastLoggedAtMs = 0

export function resetMaxStepsRateObserverStateForTests(): void {
  lastLoggedAtMs = 0
}

function maxStepsRateSnapshotPath(): string {
  return join(homedir(), '.sparkle', 'max-steps-rate-snapshot.jsonl')
}

export async function logMaxStepsRateIfDue(nowMs: number = Date.now()): Promise<void> {
  if (nowMs - lastLoggedAtMs < LOG_COOLDOWN_MS) {
    return
  }
  const segments = await readMarathonSegmentCache(nowMs)
  const failureRows = readAgentTransportJsonlTailRows()
  const ledgerRows = await ingestValidatedLedgerTerminals(nowMs)
  const snapshot = computeMaxStepsRateSnapshot(segments, failureRows, nowMs, undefined, undefined, undefined, ledgerRows)
  const attemptSnapshot = computeStreamAttemptMaxStepsRateSnapshot(ledgerRows, failureRows, segments, nowMs)
  const physicalSnapshot = computePhysicalMaxStepsRateSnapshot({
    starts: [],
    ledgerHttpSegmentStarted: segments.length,
  })
  if (attemptSnapshot.primary.startedAttempts === 0 && snapshot.primary.startedTurns === 0 && snapshot.aux24h.startedTurns === 0) {
    return
  }
  lastLoggedAtMs = nowMs
  const line = formatMaxStepsRateLogLine(snapshot, attemptSnapshot, physicalSnapshot)
  await appendAppLog(line)
  try {
    const dir = join(homedir(), '.sparkle')
    await mkdir(dir, { recursive: true })
    await appendFile(
      maxStepsRateSnapshotPath(),
      `${JSON.stringify({ ts: nowMs, ...snapshot, attempt: attemptSnapshot, physical: physicalSnapshot })}\n`,
      'utf8',
    )
  } catch {
    // snapshot jsonl is best-effort
  }
}
