import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { finished } from 'node:stream/promises'

interface FakeWindow {
  destroyed: boolean
  sent: Array<{ channel: string; payload: unknown }>
}

const world: {
  root: string
  logDir: string
  config: { saveLogs?: boolean; maxLogFileSizeMB?: number }
  windows: FakeWindow[]
  /** 为 true 时 ensureLogDir 不建目录（只生效一次），用来触发 ENOENT 重试路径。 */
  skipEnsureOnce: boolean
  /** 设置后 ensureLogDir 抛出该错误，模拟磁盘满 / 权限不足等落盘失败。 */
  ensureFailure: Error | undefined
} = {
  root: '',
  logDir: '',
  config: {},
  windows: [],
  skipEnsureOnce: false,
  ensureFailure: undefined
}

let moduleMocked = false

function loadLog(): typeof import('./log') {
  if (!moduleMocked) {
    mock.module('electron', {
      exports: {
        BrowserWindow: {
          getAllWindows: () =>
            world.windows.map((window) => ({
              isDestroyed: () => window.destroyed,
              webContents: {
                send: (channel: string, payload: unknown) => {
                  window.sent.push({ channel, payload })
                }
              }
            }))
        }
      }
    })
    mock.module('../config/app', {
      exports: { getAppConfig: async () => world.config }
    })
    mock.module('./dirs', {
      exports: {
        appLogPath: () => path.join(world.logDir, 'app.log'),
        coreLogPath: () => path.join(world.logDir, 'core.log'),
        substoreLogPath: () => path.join(world.logDir, 'substore.log'),
        ensureLogDir: () => {
          if (world.ensureFailure) {
            throw world.ensureFailure
          }
          if (world.skipEnsureOnce) {
            world.skipEnsureOnce = false
            return
          }
          mkdirSync(world.logDir, { recursive: true })
        }
      }
    })
    moduleMocked = true
  }
  delete require.cache[require.resolve('./log')]
  return require('./log')
}

const logFile = (name: string): string => path.join(world.logDir, name)
const readLog = (name: string): string => readFileSync(logFile(name), 'utf-8')

type LogWritable = ReturnType<ReturnType<typeof loadLog>['createLogWritable']>

/** 写入一段内容并等到它处理完（含落盘与缓存发布）。 */
function writeAndWait(writable: LogWritable, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    writable.write(chunk, (error) => (error ? reject(error) : resolve()))
  })
}

/** 写入全部内容并等到 final 回调（含落盘与缓存发布）完成。 */
async function pipeThrough(writable: LogWritable, ...chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    writable.write(chunk)
  }
  writable.end()
  await finished(writable)
}

describe('log', () => {
  beforeEach(() => {
    world.root = mkdtempSync(path.join(tmpdir(), 'sparkle-log-test-'))
    world.logDir = path.join(world.root, 'logs')
    world.config = {}
    world.windows = []
    world.skipEnsureOnce = false
    world.ensureFailure = undefined
  })

  afterEach(() => {
    mock.timers.reset()
    rmSync(world.root, { recursive: true, force: true })
  })

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

  describe('core log output parsing', () => {
    it('turns structured logfmt lines into cached controller logs', async () => {
      const { createLogWritable, getCachedMihomoLogs } = loadLog()
      const raw =
        'time="2026-11-12T10:00:00.123456789+08:00" level=warning msg="hello \\"world\\""\n'

      await pipeThrough(createLogWritable('core'), raw)

      assert.deepEqual(getCachedMihomoLogs(), [
        {
          type: 'warning',
          payload: 'hello "world"',
          time: new Date('2026-11-12T10:00:00.123+08:00').toLocaleString(),
          seq: 1
        }
      ])
      assert.equal(readLog('core.log'), raw, 'raw output is persisted unchanged')
    })

    it('maps level names and falls back to the stream type for unknown levels', async () => {
      const { createLogWritable, getCachedMihomoLogs } = loadLog()

      await pipeThrough(
        createLogWritable('core', 'debug'),
        [
          'level=error msg=e',
          'level=warn msg=w',
          'level=warning msg=ww',
          'level=info msg=i',
          'level=debug msg=d',
          'level=trace msg=t',
          'msg=nolevel'
        ].join('\n') + '\n'
      )

      assert.deepEqual(
        getCachedMihomoLogs().map(({ type, payload }) => ({ type, payload })),
        [
          { type: 'error', payload: 'e' },
          { type: 'warning', payload: 'w' },
          { type: 'warning', payload: 'ww' },
          { type: 'info', payload: 'i' },
          { type: 'debug', payload: 'd' },
          { type: 'debug', payload: 't' },
          { type: 'debug', payload: 'nolevel' }
        ]
      )
    })

    it('keeps unstructured lines verbatim under the stream type and stamps the receive time', async () => {
      const { createLogWritable, getCachedMihomoLogs } = loadLog()

      await pipeThrough(createLogWritable('core', 'error'), 'plain panic output\n\n   \n')

      const [entry, ...rest] = getCachedMihomoLogs()
      assert.equal(rest.length, 0, 'blank lines are skipped')
      assert.equal(entry.type, 'error')
      assert.equal(entry.payload, 'plain panic output')
      assert.ok((entry.time ?? '').length > 0, 'a receive time is filled in')
    })

    it('uses the raw line when the structured msg is blank and ignores unparsable times', async () => {
      const { createLogWritable, getCachedMihomoLogs } = loadLog()

      await pipeThrough(createLogWritable('core'), 'time=not-a-time level=info msg="  "\n')

      const [entry] = getCachedMihomoLogs()
      assert.equal(entry.payload, 'time=not-a-time level=info msg="  "')
      assert.notEqual(entry.time, 'Invalid Date')
    })

    it('reassembles a line that arrives in several chunks', async () => {
      const { createLogWritable, getCachedMihomoLogs } = loadLog()
      const writable = createLogWritable('core')

      writable.write('level=info msg=he')
      await writeAndWait(writable, 'llo\r\nlevel=error msg=a')
      assert.deepEqual(
        getCachedMihomoLogs().map(({ payload }) => payload),
        ['hello'],
        'only complete lines are published'
      )

      writable.end('b\n')
      await finished(writable)
      assert.deepEqual(
        getCachedMihomoLogs().map(({ type, payload }) => `${type}:${payload}`),
        ['info:hello', 'error:ab']
      )
    })

    it('flushes a trailing partial line when the stream ends or is destroyed', async () => {
      const { createLogWritable, getCachedMihomoLogs, clearCachedMihomoLogs } = loadLog()

      await pipeThrough(createLogWritable('core'), 'level=error msg=boom')
      assert.deepEqual(
        getCachedMihomoLogs().map(({ type, payload }) => `${type}:${payload}`),
        ['error:boom']
      )

      clearCachedMihomoLogs()
      const destroyed = createLogWritable('core')
      await writeAndWait(destroyed, 'level=warn msg=cut')
      destroyed.destroy()
      await finished(destroyed).catch(() => undefined)
      assert.deepEqual(
        getCachedMihomoLogs().map(({ type, payload }) => `${type}:${payload}`),
        ['warning:cut']
      )
    })

    it('keeps the output pipe alive when persisting fails, and still publishes parsed lines', async () => {
      const { appendAppLog, createLogWritable, getCachedMihomoLogs } = loadLog()
      world.ensureFailure = new Error('ENOSPC: no space left on device')
      const writable = createLogWritable('core')
      const errors: Error[] = []
      writable.on('error', (error) => errors.push(error))

      await pipeThrough(writable, 'level=info msg=still-shown\n')

      assert.deepEqual(errors, [])
      assert.deepEqual(
        getCachedMihomoLogs().map(({ payload }) => payload),
        ['still-shown']
      )
      world.ensureFailure = undefined
      await appendAppLog('disk is back')
      assert.match(readLog('app.log'), / disk is back\n$/)
    })

    it('does not parse app or substore output but still persists it', async () => {
      const { createLogWritable, getCachedMihomoLogs } = loadLog()

      await pipeThrough(createLogWritable('substore'), 'level=info msg=sub\n')

      assert.deepEqual(getCachedMihomoLogs(), [])
      assert.equal(readLog('substore.log'), 'level=info msg=sub\n')
    })

    it('hands the log writing over to the websocket feed in ws mode', async () => {
      const { createLogWritable, getCachedMihomoLogs, publishMihomoLog, setMihomoLogSource } =
        loadLog()

      publishMihomoLog({ type: 'info', payload: 'ignored while reading stdout' })
      assert.deepEqual(getCachedMihomoLogs(), [])

      setMihomoLogSource('ws')
      await pipeThrough(createLogWritable('core'), 'level=error msg=from-stdout\n')
      assert.deepEqual(getCachedMihomoLogs(), [], 'stdout lines are no longer parsed')
      assert.equal(readLog('core.log'), 'level=error msg=from-stdout\n', 'but still persisted')

      publishMihomoLog({ type: 'warning', payload: 'from ws', time: 'T1' })
      assert.deepEqual(getCachedMihomoLogs(), [
        { type: 'warning', payload: 'from ws', time: 'T1', seq: 1 }
      ])
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

  describe('shared write streams', () => {
    it('keeps appending for the second writer after the first one ends', async () => {
      const { createLogWritable } = loadLog()
      const first = createLogWritable('substore')
      const second = createLogWritable('substore')

      await pipeThrough(first, 'one\n')
      await pipeThrough(second, 'two\n')

      assert.equal(readLog('substore.log'), 'one\ntwo\n')
    })

    it('reopens the file for a writer created after every earlier writer has ended', async () => {
      const { createLogWritable } = loadLog()

      await pipeThrough(createLogWritable('substore'), 'one\n')
      await pipeThrough(createLogWritable('substore'), 'two\n')

      assert.equal(readLog('substore.log'), 'one\ntwo\n')
    })
  })
})
