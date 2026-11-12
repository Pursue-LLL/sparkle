import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { finished } from 'node:stream/promises'
import {
  cleanupWorld,
  loadLog,
  pipeThrough,
  readLog,
  resetWorld,
  world,
  writeAndWait
} from './logTestRig'

describe('core log output parsing', () => {
  beforeEach(resetWorld)
  afterEach(cleanupWorld)

  it('turns structured logfmt lines into cached controller logs', async () => {
    const { createLogWritable, getCachedMihomoLogs } = loadLog()
    const raw = 'time="2026-11-12T10:00:00.123456789+08:00" level=warning msg="hello \\"world\\""\n'

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

  it('keeps unstructured lines verbatim under the stream type and stamps the receive time', async () => {
    const { createLogWritable, getCachedMihomoLogs } = loadLog()

    await pipeThrough(createLogWritable('core', 'error'), 'plain panic output\n\n   \n')

    const [entry, ...rest] = getCachedMihomoLogs()
    assert.equal(rest.length, 0, 'blank lines are skipped')
    assert.equal(entry.type, 'error')
    assert.equal(entry.payload, 'plain panic output')
    assert.ok((entry.time ?? '').length > 0, 'a receive time is filled in')
  })

  it('publishes single-character lines and persists single-byte writes', async () => {
    const { createLogWritable, getCachedMihomoLogs } = loadLog()

    await pipeThrough(createLogWritable('core'), 'x\n')
    const raw = createLogWritable('substore')
    raw.write(Buffer.from('y'))
    raw.end()
    await finished(raw)

    assert.deepEqual(
      getCachedMihomoLogs().map(({ payload }) => payload),
      ['x']
    )
    assert.equal(readLog('substore.log'), 'y')
  })

  it('handles chunks that were queued together', async () => {
    const { createLogWritable, getCachedMihomoLogs } = loadLog()
    const writer = createLogWritable('core')

    writer.cork()
    writer.write('level=info msg=first\n')
    writer.write('level=warn msg=second\nlevel=error msg=th')
    writer.write('ird\n')
    writer.uncork()
    writer.cork()
    writer.write('level=debug msg=single\n')
    writer.uncork()
    writer.end()
    await finished(writer)

    assert.deepEqual(
      getCachedMihomoLogs().map(({ type, payload }) => `${type}:${payload}`),
      ['info:first', 'warning:second', 'error:third', 'debug:single']
    )
    assert.equal(
      readLog('core.log'),
      'level=info msg=first\nlevel=warn msg=second\nlevel=error msg=third\nlevel=debug msg=single\n'
    )
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
