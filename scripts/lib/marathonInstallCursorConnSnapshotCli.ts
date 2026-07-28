#!/usr/bin/env tsx
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  assertPostQuitInstallAllowed,
  buildPreInstallCursorConnSnapshot,
  getPreInstallCursorConnSnapshotPath,
  parsePreInstallCursorConnSnapshot,
  readFreshMarathonGuardStatePayload,
  type MarathonGuardStateFilePayload,
} from './marathonInstallCursorConnSnapshotCore'

const GUARD_STATE_FILE = `${process.env.HOME}/.sparkle/marathon-core-restart-guard.json`

async function readGuardState(): Promise<MarathonGuardStateFilePayload | null> {
  try {
    const raw = JSON.parse(await readFile(GUARD_STATE_FILE, 'utf8')) as MarathonGuardStateFilePayload
    return readFreshMarathonGuardStatePayload(raw)
  } catch {
    return null
  }
}

async function writeSnapshot(caller: string, cursorConnArg: string): Promise<void> {
  const cursorConnectionCount = Number(cursorConnArg)
  if (!Number.isFinite(cursorConnectionCount) || cursorConnectionCount < 0) {
    process.stderr.write('[snapshot] FAIL: invalid cursor_conn\n')
    process.exit(1)
  }
  const guardState = await readGuardState()
  const snapshot = buildPreInstallCursorConnSnapshot({
    cursorConnectionCount,
    quiesceActive: guardState?.quiesceActive === true,
    blockColdRestart: guardState?.blockColdRestart === true,
    caller,
  })
  const path = getPreInstallCursorConnSnapshotPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(snapshot)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(snapshot)}\n`)
}

async function assertSnapshot(caller: string): Promise<void> {
  const path = getPreInstallCursorConnSnapshotPath()
  let snapshot = null
  try {
    snapshot = parsePreInstallCursorConnSnapshot(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    snapshot = null
  }
  const decision = assertPostQuitInstallAllowed(snapshot)
  if (!decision.allowed) {
    process.stderr.write(
      `[snapshot] FAIL caller=${caller} reason=${decision.reason} path=${path}\n`,
    )
    process.exit(1)
  }
  process.stdout.write(`[snapshot] PASS caller=${caller} reason=${decision.reason}\n`)
}

async function clearSnapshot(): Promise<void> {
  await rm(getPreInstallCursorConnSnapshotPath(), { force: true })
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'write') {
    await writeSnapshot(args[0] ?? 'install', args[1] ?? '0')
    return
  }
  if (command === 'assert') {
    await assertSnapshot(args[0] ?? 'install')
    return
  }
  if (command === 'clear') {
    await clearSnapshot()
    return
  }
  process.stderr.write('usage: write <caller> <cursor_conn> | assert <caller> | clear\n')
  process.exit(1)
}

void main()
