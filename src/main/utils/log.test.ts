import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import {
  cleanupWorld,
  type FakeWindow,
  loadLog,
  logFile,
  readLog,
  resetWorld,
  world
} from './logTestRig'

describe('log', () => {
  beforeEach(resetWorld)

  afterEach(cleanupWorld)

  describe('appendAppLog', () => {
    it('stamps every non-empty line with an ISO timestamp and appends it to app.log', async () => {
      mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 12, 4, 0, 0) })
      const { appendAppLog } = loadLog()

      await appendAppLog('first\n\nsecond\n')
      await appendAppLog('third')

      assert.equal(
        readLog('app.log'),
        '2026-11-12T04:00:00.000Z first\n2026-11-12T04:00:00.000Z second\n2026-11-12T04:00:00.000Z third\n'
      )
    })

    it('writes blank-only content as is and ignores empty content', async () => {
      const { appendAppLog } = loadLog()

      await appendAppLog('')
      assert.equal(existsSync(logFile('app.log')), false)

      await appendAppLog('\n')
      assert.equal(readLog('app.log'), '\n')
    })

    it('writes nothing when log saving is turned off', async () => {
      world.config = { saveLogs: false }
      const { appendAppLog } = loadLog()

      await appendAppLog('should not be written')

      assert.equal(existsSync(logFile('app.log')), false)
    })

    it('recreates a missing log directory and retries the write', async () => {
      const { appendAppLog } = loadLog()
      world.skipEnsureOnce = true

      await appendAppLog('recovered')
      await appendAppLog('next')

      assert.match(readLog('app.log'), / recovered\n.* next\n$/)
    })

    it('reports a failed write to the caller without blocking later writes', async () => {
      const { appendAppLog } = loadLog()
      world.ensureFailure = new Error('EACCES: permission denied')

      await assert.rejects(appendAppLog('lost'), /EACCES/)

      world.ensureFailure = undefined
      await appendAppLog('kept')
      assert.match(readLog('app.log'), / kept\n$/)
      assert.equal(readLog('app.log').includes('lost'), false)
    })

    it('trims the oldest lines once the file exceeds the size limit', async () => {
      world.config = { maxLogFileSizeMB: 1 }
      const { appendAppLog } = loadLog()
      const oneMiB = 1024 * 1024
      const body = 'x'.repeat(1000)

      for (let index = 0; index < 1100; index++) {
        await appendAppLog(`${String(index).padStart(4, '0')} ${body}`)
      }

      const content = readLog('app.log')
      const lines = content.trimEnd().split('\n')
      assert.ok(Buffer.byteLength(content) <= oneMiB, 'file stays within the limit')
      assert.ok(lines.length < 1100, 'old lines were dropped')
      assert.match(lines.at(-1) ?? '', / 1099 x+$/, 'newest line is kept')
      assert.equal(content.includes(' 0000 '), false, 'oldest line is gone')
      assert.ok(content.endsWith('\n'), 'trimming keeps whole lines')
    })

    it('treats a limit below 1 MB as 1 MB', async () => {
      world.config = { maxLogFileSizeMB: 0.4 }
      const { appendAppLog } = loadLog()

      for (let index = 0; index < 600; index++) {
        await appendAppLog(`${String(index).padStart(4, '0')} ${'y'.repeat(1000)}`)
      }

      const lines = readLog('app.log').trimEnd().split('\n')
      assert.equal(lines.length, 600, '0.5 MB written stays below the 1 MB floor, nothing trimmed')
    })
  })

  describe('log cache and broadcast', () => {
    it('keeps the newest 2000 entries with increasing sequence numbers', () => {
      const { clearCachedMihomoLogs, getCachedMihomoLogs, publishMihomoLog, setMihomoLogSource } =
        loadLog()
      setMihomoLogSource('ws')

      for (let index = 1; index <= 2005; index++) {
        publishMihomoLog({ type: 'info', payload: `log-${index}`, time: 'T' })
      }

      const cached = getCachedMihomoLogs()
      assert.equal(cached.length, 2000)
      assert.equal(cached[0].seq, 6)
      assert.equal(cached[0].payload, 'log-6')
      assert.equal(cached.at(-1)?.seq, 2005)

      cached.length = 0
      assert.equal(getCachedMihomoLogs().length, 2000, 'callers get a copy')

      clearCachedMihomoLogs()
      assert.deepEqual(getCachedMihomoLogs(), [])
    })

    it('broadcasts each log to live windows only', () => {
      const { publishMihomoLog, setMihomoLogSource } = loadLog()
      setMihomoLogSource('ws')
      const live: FakeWindow = { destroyed: false, sent: [] }
      const closed: FakeWindow = { destroyed: true, sent: [] }
      world.windows = [closed, live]

      publishMihomoLog({ type: 'info', payload: 'hello', time: 'T' })

      assert.deepEqual(live.sent, [
        { channel: 'mihomoLogs', payload: { type: 'info', payload: 'hello', time: 'T', seq: 1 } }
      ])
      assert.deepEqual(closed.sent, [])
    })

    it('stamps entries without a time with the receive time', () => {
      const { getCachedMihomoLogs, publishMihomoLog, setMihomoLogSource } = loadLog()
      setMihomoLogSource('ws')
      mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 12, 4, 0, 0) })

      publishMihomoLog({ type: 'info', payload: 'no time' })

      assert.equal(
        getCachedMihomoLogs()[0].time,
        new Date(Date.UTC(2026, 10, 12, 4, 0, 0)).toLocaleString()
      )
    })
  })
})
