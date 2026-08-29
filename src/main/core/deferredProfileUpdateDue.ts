// [INPUT] deferredProfileUpdateDueCore · fs · runDueProfileUpdates
// [OUTPUT] markDeferredProfileUpdateDue · maybeExecuteDeferredProfileUpdateDue
// [POS] Runtime deferred profile refresh after marathon guard clears

import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { appendAppLog } from '../utils/log'
import {
  DEFERRED_PROFILE_UPDATE_DUE_RELATIVE_PATH,
  parseDeferredProfileUpdateDueRecord,
  serializeDeferredProfileUpdateDueRecord,
  shouldExecuteDeferredProfileUpdateDue,
  type DeferredProfileUpdateDueRecord,
} from './deferredProfileUpdateDueCore'
import type { MarathonCoreRestartGuardSnapshot } from './marathonCoreRestartGuardCore'

function deferredProfileUpdateDuePath(): string {
  return join(homedir(), DEFERRED_PROFILE_UPDATE_DUE_RELATIVE_PATH)
}

export async function markDeferredProfileUpdateDue(
  source: DeferredProfileUpdateDueRecord['source'],
): Promise<void> {
  const record: DeferredProfileUpdateDueRecord = {
    requestedAtMs: Date.now(),
    source,
  }
  const filePath = deferredProfileUpdateDuePath()
  await mkdir(join(homedir(), '.sparkle'), { recursive: true })
  await writeFile(filePath, serializeDeferredProfileUpdateDueRecord(record), 'utf-8')
  await appendAppLog(
    `[ProfileUpdaterCli]: deferred_profile_update_queued source=${source} path=${filePath}\n`,
  )
}

async function readDeferredProfileUpdateDueRecord(): Promise<DeferredProfileUpdateDueRecord | null> {
  try {
    const raw = await readFile(deferredProfileUpdateDuePath(), 'utf-8')
    return parseDeferredProfileUpdateDueRecord(raw)
  } catch {
    return null
  }
}

export async function maybeExecuteDeferredProfileUpdateDue(
  snapshot: MarathonCoreRestartGuardSnapshot,
): Promise<void> {
  if (!shouldExecuteDeferredProfileUpdateDue(snapshot)) {
    return
  }

  const pending = await readDeferredProfileUpdateDueRecord()
  if (!pending) {
    return
  }

  await unlink(deferredProfileUpdateDuePath()).catch(() => {})
  await appendAppLog(
    `[ProfileUpdaterCli]: deferred_profile_update_executing source=${pending.source} age_ms=${Date.now() - pending.requestedAtMs}\n`,
  )

  const { runDueProfileUpdates } = await import('./profileUpdater')
  try {
    const updatedCount = await runDueProfileUpdates('cli')
    await appendAppLog(
      `[ProfileUpdaterCli]: deferred_profile_update_complete updated_count=${updatedCount}\n`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendAppLog(`[ProfileUpdaterCli]: deferred_profile_update_failed: ${message}\n`)
    await markDeferredProfileUpdateDue(pending.source)
  }
}
