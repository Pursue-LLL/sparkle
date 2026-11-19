import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import type * as Evidence from './sparkleAgyEvidence'
import {
  benignAicodeTimeoutRecord,
  fetchConfigRejectionRecord,
  generationRejectionRecord
} from './sparkleAgyEvidenceFixtures'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS

describe('collectAgyProductionEvidence', () => {
  let root = ''
  let evidence: typeof Evidence
  let savedHome: string | undefined
  const ps = { output: '', failed: false }
  const home = (): string => path.join(root, 'home')
  const dataRoot = (): string => path.join(root, 'data')
  const defaultLogDir = (): string => path.join(home(), '.gemini', 'antigravity-cli', 'log')
  const launcherLog = (name: string): string => path.join(root, 'launcher', name)

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sparkle-agy-evidence-'))
    savedHome = process.env.HOME
    process.env.HOME = home()
    mock.module('node:child_process', {
      exports: {
        spawn: () => {
          throw new Error('the evidence reader must not start processes of its own')
        },
        execFile: (
          _command: string,
          _args: string[],
          _options: object,
          callback: (error: Error | null, stdout: string) => void
        ): void => {
          queueMicrotask(() =>
            ps.failed ? callback(new Error('ps is not available'), '') : callback(null, ps.output)
          )
        }
      }
    })
    mock.module('../utils/dirs', { exports: { dataDir: () => dataRoot() } })
    evidence = require('./sparkleAgyEvidence') as typeof Evidence
  })

  after(() => {
    if (savedHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = savedHome
    }
    rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    for (const dir of [home(), dataRoot(), path.dirname(launcherLog('x'))]) {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
    }
    ps.output = ''
    ps.failed = false
  })

  /** 写一份日志并把它的修改时间设成 `ageMs` 之前。 */
  function writeLog(file: string, text: string, now: number, ageMs: number): number {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${text}\n`, 'utf8')
    const modifiedAt = new Date(now - ageMs)
    utimesSync(file, modifiedAt, modifiedAt)
    return modifiedAt.getTime()
  }

  const agyProcess = (logFile: string): string => `/Users/me/.local/bin/agy --log-file ${logFile}`

  it('merges the default log directory with the logs named by running agy processes', async () => {
    const now = Date.now()
    writeLog(
      path.join(defaultLogDir(), 'cli-1.log'),
      generationRejectionRecord(now - 3 * MINUTE_MS),
      now,
      MINUTE_MS
    )
    const newest = writeLog(
      launcherLog('session-1.log'),
      fetchConfigRejectionRecord(now - 2 * MINUTE_MS),
      now,
      30 * SECOND_MS
    )
    ps.output = `/sbin/launchd\n${agyProcess(launcherLog('session-1.log'))}\n`

    const found = await evidence.collectAgyProductionEvidence(now)

    assert.deepEqual(found.rejections, {
      generation: [expectedSecond(now - 3 * MINUTE_MS)],
      aicode: [expectedSecond(now - 2 * MINUTE_MS)]
    })
    assert.equal(found.lastActivityMs, newest)
  })

  it('reads a log that is both in the default directory and named by a process only once', async () => {
    const now = Date.now()
    const file = path.join(defaultLogDir(), 'cli-1.log')
    writeLog(file, generationRejectionRecord(now - MINUTE_MS), now, SECOND_MS)
    ps.output = agyProcess(file)

    const found = await evidence.collectAgyProductionEvidence(now)

    assert.equal(found.rejections.generation.length, 1)
  })

  it('does not treat logs written by the probe itself as production evidence', async () => {
    const now = Date.now()
    const probeLog = path.join(dataRoot(), 'agy-probe', 'antigravity-cli', 'log', 'probe-1.log')
    writeLog(probeLog, generationRejectionRecord(now - MINUTE_MS), now, SECOND_MS)
    writeLog(
      path.join(dataRoot(), 'agy-probe-other', 'sibling.log'),
      fetchConfigRejectionRecord(now - MINUTE_MS),
      now,
      SECOND_MS
    )
    ps.output = `${agyProcess(probeLog)}\n${agyProcess(path.join(dataRoot(), 'agy-probe-other', 'sibling.log'))}`

    const found = await evidence.collectAgyProductionEvidence(now)

    assert.deepEqual(found.rejections, {
      generation: [],
      aicode: [expectedSecond(now - MINUTE_MS)]
    })
    assert.notEqual(found.lastActivityMs, null)
  })

  it('skips logs that have not been written within the evidence window', async () => {
    const now = Date.now()
    const edge = path.join(defaultLogDir(), 'cli-edge.log')
    const stale = path.join(defaultLogDir(), 'cli-stale.log')
    writeLog(edge, generationRejectionRecord(now - 9 * MINUTE_MS), now, 10 * MINUTE_MS)
    writeLog(stale, fetchConfigRejectionRecord(now - 9 * MINUTE_MS), now, 10 * MINUTE_MS + 1)

    const found = await evidence.collectAgyProductionEvidence(now)

    assert.equal(found.rejections.generation.length, 1)
    assert.equal(found.rejections.aicode.length, 0)
  })

  it('reports no activity when no session has written a log recently', async () => {
    const now = Date.now()
    writeLog(
      path.join(defaultLogDir(), 'cli-old.log'),
      benignAicodeTimeoutRecord(now - 60 * MINUTE_MS),
      now,
      60 * MINUTE_MS
    )

    assert.deepEqual(await evidence.collectAgyProductionEvidence(now), {
      rejections: { generation: [], aicode: [] },
      lastActivityMs: null
    })
  })

  it('reads only the tail of a large log', async () => {
    const now = Date.now()
    const filler = benignAicodeTimeoutRecord(now - 5 * MINUTE_MS)
    const body = [
      // 在尾部之外的旧记录：时间戳虽然落在窗口里，但整份日志的头部不读。
      generationRejectionRecord(now - 8 * MINUTE_MS),
      ...new Array<string>(Math.ceil((700 * 1024) / filler.length)).fill(filler),
      fetchConfigRejectionRecord(now - MINUTE_MS)
    ].join('\n')
    writeLog(path.join(defaultLogDir(), 'cli-big.log'), body, now, SECOND_MS)

    const found = await evidence.collectAgyProductionEvidence(now)

    assert.equal(found.rejections.generation.length, 0)
    assert.equal(found.rejections.aicode.length, 1)
  })

  it('reads at most the sixteen most recently written logs', async () => {
    const now = Date.now()
    for (let index = 0; index < 20; index++) {
      writeLog(
        path.join(defaultLogDir(), `cli-${String(index).padStart(2, '0')}.log`),
        fetchConfigRejectionRecord(now - MINUTE_MS),
        now,
        (index + 1) * SECOND_MS
      )
    }

    const found = await evidence.collectAgyProductionEvidence(now)

    assert.equal(found.rejections.aicode.length, 16)
  })

  it('still reads the default directory when the process list is unavailable', async () => {
    const now = Date.now()
    writeLog(
      path.join(defaultLogDir(), 'cli-1.log'),
      generationRejectionRecord(now - MINUTE_MS),
      now,
      SECOND_MS
    )
    ps.failed = true

    const found = await evidence.collectAgyProductionEvidence(now)

    assert.equal(found.rejections.generation.length, 1)
  })

  it('treats a missing directory, a missing file and a relative path as no evidence', async () => {
    const now = Date.now()
    ps.output = `${agyProcess(launcherLog('gone.log'))}\n/Users/me/.local/bin/agy --log-file relative.log`

    assert.deepEqual(await evidence.collectAgyProductionEvidence(now), {
      rejections: { generation: [], aicode: [] },
      lastActivityMs: null
    })
  })

  it('returns fresh containers on every call', async () => {
    const now = Date.now()
    const first = await evidence.collectAgyProductionEvidence(now)
    first.rejections.generation.push(now)

    const second = await evidence.collectAgyProductionEvidence(now)

    assert.deepEqual(second.rejections.generation, [])
  })
})

/** 夹具里的时间戳只精确到秒。 */
function expectedSecond(ms: number): number {
  return new Date(ms).setMilliseconds(0)
}
