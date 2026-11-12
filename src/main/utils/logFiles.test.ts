import assert from 'node:assert/strict'
import { mkdirSync, statSync, writeFileSync, type WriteStream } from 'node:fs'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { finished } from 'node:stream/promises'
import {
  cleanupWorld,
  loadLog,
  logFile,
  pipeThrough,
  readLog,
  resetWorld,
  settlesWithin,
  world,
  writeAndWait
} from './logTestRig'

const ONE_MIB = 1024 * 1024
const TRIM_TARGET = Math.floor(ONE_MIB * 0.7)

/** count 行、每行恰好 lineBytes 字节（含换行）；行首是 4 位序号，便于判断留下了哪些行。 */
function numberedLines(count: number, lineBytes: number, label = ''): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `${label}${String(index).padStart(4, '0')}${'x'.repeat(lineBytes - 5 - label.length)}\n`
  ).join('')
}

const sizeOf = (name: string): number => statSync(logFile(name)).size

/** 等流关闭（不用 events.once：流出错时它会 reject）。 */
function streamClosed(stream: WriteStream): Promise<void> {
  if (stream.closed) return Promise.resolve()
  return new Promise((resolve) => {
    stream.once('close', () => resolve())
  })
}

describe('log file size limit', () => {
  beforeEach(resetWorld)
  afterEach(cleanupWorld)

  it('keeps the newest whole lines that fit under 70% of the limit', async () => {
    world.config = { maxLogFileSizeMB: 1 }
    const { createLogWritable } = loadLog()

    await pipeThrough(createLogWritable('substore'), numberedLines(1025, 1024))

    const content = readLog('substore.log')
    assert.equal(Buffer.byteLength(content), 716 * 1024)
    assert.equal(content.slice(0, 4), '0309')
    assert.equal(content.slice(-1024, -1020), '1024')
  })

  it('keeps a missing trailing newline missing', async () => {
    world.config = { maxLogFileSizeMB: 1 }
    const { createLogWritable } = loadLog()

    await pipeThrough(createLogWritable('substore'), numberedLines(1025, 1024).slice(0, -1))

    const content = readLog('substore.log')
    assert.equal(Buffer.byteLength(content), 715 * 1024 + 1023)
    assert.equal(content.slice(0, 4), '0309')
    assert.equal(content.endsWith('\n'), false)
  })

  it('writes trimmed content with LF line endings', async () => {
    world.config = { maxLogFileSizeMB: 1 }
    const { createLogWritable } = loadLog()
    const crlfLines = numberedLines(1025, 1024).replace(/\n/g, '\r\n')

    await pipeThrough(createLogWritable('substore'), crlfLines)

    const content = readLog('substore.log')
    assert.equal(content.includes('\r'), false)
    assert.ok(Buffer.byteLength(content) <= TRIM_TARGET)
    assert.ok(content.startsWith('03'))
  })

  it('trims only when the file grows past the limit, not when it reaches it', async () => {
    world.config = { maxLogFileSizeMB: 1 }
    mkdirSync(world.logDir, { recursive: true })
    writeFileSync(logFile('substore.log'), numberedLines(1023, 1024))
    const { createLogWritable } = loadLog()

    await pipeThrough(createLogWritable('substore'), `${'y'.repeat(1023)}\n`)
    assert.equal(sizeOf('substore.log'), ONE_MIB)

    await pipeThrough(createLogWritable('substore'), 'z\n')
    assert.ok(sizeOf('substore.log') <= TRIM_TARGET)
  })

  it('counts the content that was already in the file when it is first appended to', async () => {
    world.config = { maxLogFileSizeMB: 1 }
    mkdirSync(world.logDir, { recursive: true })
    writeFileSync(logFile('substore.log'), numberedLines(1024, 1024))
    const { createLogWritable } = loadLog()

    await pipeThrough(createLogWritable('substore'), 'z\n')

    const content = readLog('substore.log')
    assert.ok(Buffer.byteLength(content) <= TRIM_TARGET)
    assert.ok(content.endsWith('z\n'), 'the new line survives the trim')
  })

  it('starts counting again from the trimmed size', async () => {
    world.config = { maxLogFileSizeMB: 1 }
    const { createLogWritable } = loadLog()
    const writer = createLogWritable('substore')

    await writeAndWait(writer, numberedLines(1025, 1024))
    assert.equal(sizeOf('substore.log'), 716 * 1024)

    await writeAndWait(writer, numberedLines(300, 1000, 'A'))
    assert.equal(sizeOf('substore.log'), 716 * 1024 + 300 * 1000, 'still below the limit')
    assert.equal(readLog('substore.log').slice(0, 4), '0309')

    await writeAndWait(writer, numberedLines(20, 1000, 'B'))
    assert.ok(sizeOf('substore.log') <= TRIM_TARGET)
    assert.ok(readLog('substore.log').endsWith(`B0019${'x'.repeat(994)}\n`))
    writer.end()
    await finished(writer)
  })

  it('uses a 2 MB limit when configured', async () => {
    world.config = { maxLogFileSizeMB: 2 }
    const { createLogWritable } = loadLog()

    await pipeThrough(createLogWritable('substore'), numberedLines(1500, 1024))

    assert.equal(sizeOf('substore.log'), 1500 * 1024)
  })

  it('rounds a fractional limit down and never goes below 1 MB', async () => {
    const { createLogWritable } = loadLog()

    world.config = { maxLogFileSizeMB: 0.4 }
    await pipeThrough(createLogWritable('substore'), numberedLines(1025, 1024))
    assert.equal(sizeOf('substore.log'), 716 * 1024)

    world.config = { maxLogFileSizeMB: Number.NaN }
    await pipeThrough(createLogWritable('app'), numberedLines(1025, 1024))
    assert.equal(sizeOf('app.log'), 716 * 1024)

    world.config = { maxLogFileSizeMB: 1.9 }
    await pipeThrough(createLogWritable('core'), numberedLines(1025, 1024))
    assert.equal(sizeOf('core.log'), 716 * 1024)
  })

  it('limits each log file to 20 MB unless configured otherwise', async () => {
    const { createLogWritable } = loadLog()
    const twentyMiB = 20 * ONE_MIB

    await pipeThrough(createLogWritable('substore'), `${'x'.repeat(1023)}\n`.repeat(20480))
    assert.equal(sizeOf('substore.log'), twentyMiB, 'exactly at the limit is kept')

    await pipeThrough(createLogWritable('substore'), 'z\n')
    assert.ok(sizeOf('substore.log') <= Math.floor(twentyMiB * 0.7))
  })

  it('keeps the limit when many appends arrive at the same time', async () => {
    world.config = { maxLogFileSizeMB: 1 }
    const { appendAppLog } = loadLog()
    const body = 'x'.repeat(1000)

    await Promise.all(
      Array.from({ length: 1500 }, (_, index) =>
        appendAppLog(`${String(index).padStart(4, '0')} ${body}`)
      )
    )

    const content = readLog('app.log')
    assert.ok(Buffer.byteLength(content) <= ONE_MIB, 'the file stays within the limit')
    assert.ok(content.includes(' 1499 '), 'the newest line is kept')
    assert.equal(content.includes(' 0000 '), false, 'the oldest line is gone')
  })

  it('leaves the file alone when the cached size was too high', async () => {
    world.config = { maxLogFileSizeMB: 1 }
    const { createLogWritable } = loadLog()
    const writer = createLogWritable('substore')
    await writeAndWait(writer, numberedLines(1000, 1024))

    // 文件被外部改小后，缓存的大小偏高：裁剪前重读发现并不超限，不应改写
    writeFileSync(logFile('substore.log'), 'kept\r\nas written\r\n')
    await writeAndWait(writer, numberedLines(60, 1024))

    assert.ok(readLog('substore.log').startsWith('kept\r\nas written\r\n'))
    assert.equal(sizeOf('substore.log'), 'kept\r\nas written\r\n'.length + 60 * 1024)
    writer.end()
    await finished(writer)
  })

  it('closes the append stream before rewriting a trimmed file', async () => {
    world.config = { maxLogFileSizeMB: 1 }
    const { createLogWritable } = loadLog()
    const writer = createLogWritable('substore')

    await writeAndWait(writer, numberedLines(1025, 1024))
    assert.equal(world.streams[0].closed, true)
    await writeAndWait(writer, 'after\n')

    assert.equal(world.streams.length, 2)
    assert.ok(readLog('substore.log').endsWith('after\n'))
  })

  it('writes concurrent appends in call order', async () => {
    const { appendAppLog } = loadLog()

    await Promise.all(['one', 'two', 'three'].map((line) => appendAppLog(line)))

    assert.deepEqual(
      readLog('app.log')
        .trimEnd()
        .split('\n')
        .map((line) => line.split(' ')[1]),
      ['one', 'two', 'three']
    )
  })
})

describe('log write streams', () => {
  beforeEach(resetWorld)
  afterEach(cleanupWorld)

  it('shares one stream between writers of the same log and closes it with the last one', async () => {
    const { createLogWritable } = loadLog()
    const first = createLogWritable('substore')
    const second = createLogWritable('substore')

    await writeAndWait(first, 'one\n')
    await writeAndWait(second, 'two\n')
    assert.equal(world.streams.length, 1)

    first.end()
    await finished(first)
    assert.equal(world.streams[0].writableEnded, false, 'the second writer still uses it')
    await writeAndWait(second, 'three\n')
    assert.equal(world.streams.length, 1)

    second.end()
    await finished(second)
    await streamClosed(world.streams[0])
    assert.equal(readLog('substore.log'), 'one\ntwo\nthree\n')

    await pipeThrough(createLogWritable('substore'), 'four\n')
    assert.equal(world.streams.length, 2, 'a later writer reopens the file')
    assert.equal(readLog('substore.log'), 'one\ntwo\nthree\nfour\n')
  })

  it('does not release a writer twice when it is destroyed right after ending', async () => {
    const { createLogWritable } = loadLog()
    const first = createLogWritable('substore')
    const second = createLogWritable('substore')
    await writeAndWait(second, 'a\n')

    first.end()
    await finished(first)
    await writeAndWait(second, 'b\n')

    assert.equal(world.streams.length, 1)
    assert.equal(world.streams[0].writableEnded, false)
  })

  it('switches to a new stream when the log path changes', async () => {
    const { createLogWritable } = loadLog()
    const writer = createLogWritable('substore')
    const originalDir = world.logDir

    await writeAndWait(writer, 'old\n')
    world.logDir = `${world.logDir}-moved`
    await writeAndWait(writer, 'new\n')

    assert.equal(world.streams.length, 2)
    assert.equal(world.streams[0].writableEnded, true)
    assert.equal(readLog('substore.log'), 'new\n')
    world.logDir = originalDir
    assert.equal(readLog('substore.log'), 'old\n')
  })

  it('closes the file again after a later cycle of writers', async () => {
    const { createLogWritable } = loadLog()

    await pipeThrough(createLogWritable('substore'), 'one\n')
    await pipeThrough(createLogWritable('substore'), 'two\n')

    await streamClosed(world.streams[1])
    assert.equal(world.streams.length, 2)
  })

  it('releases the shared stream when the last writer is destroyed without ending', async () => {
    const { createLogWritable } = loadLog()
    const writer = createLogWritable('substore')
    await writeAndWait(writer, 'partial\n')

    writer.destroy()

    await streamClosed(world.streams[0])
    assert.equal(readLog('substore.log'), 'partial\n')
  })

  it('keeps the current stream when a replaced one fails late', async () => {
    const { createLogWritable } = loadLog()
    const writer = createLogWritable('substore')
    await writeAndWait(writer, 'old\n')
    world.logDir = `${world.logDir}-moved`
    await writeAndWait(writer, 'new\n')

    world.streams[0].emit('error', new Error('EIO: late failure'))
    await writeAndWait(writer, 'newer\n')

    assert.equal(world.streams.length, 2)
    assert.equal(readLog('substore.log'), 'new\nnewer\n')
  })

  it('does not hang on a stream that was destroyed behind its back', async () => {
    const { appendAppLog } = loadLog()
    await appendAppLog('one')

    world.streams[0].destroy()
    await streamClosed(world.streams[0])
    assert.equal(await settlesWithin(appendAppLog('lost'), 3000), true)
    await appendAppLog('three')

    const content = readLog('app.log')
    assert.match(content, / one\n/)
    assert.match(content, / three\n/)
    assert.equal(content.includes('lost'), false)
  })

  it('reopens the file after the stream failed', async () => {
    const { createLogWritable } = loadLog()
    const writer = createLogWritable('substore')
    await writeAndWait(writer, 'before\n')

    world.streams[0].destroy(new Error('EIO: i/o error'))
    await streamClosed(world.streams[0])
    await writeAndWait(writer, 'after\n')

    assert.equal(world.streams.length, 2)
    assert.equal(readLog('substore.log'), 'before\nafter\n')
  })
})
