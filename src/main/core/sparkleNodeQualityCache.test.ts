import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile as realReadFile, writeFile as realWriteFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setImmediate as settle } from 'node:timers/promises'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import type * as Cache from './sparkleNodeQualityCache'
import { SINK_TTL_MS } from './sparkleNodeQualityCore'

const NOW = 1_700_000_000_000

type WriteFile = typeof realWriteFile

describe('sparkleNodeQualityCache', () => {
  let root = ''
  let dataDir = ''
  let cache: typeof Cache
  let writeHook: WriteFile = realWriteFile
  const recordFile = (): string => path.join(dataDir, 'sparkle-node-quality.json')

  /** 每次都装载全新的模块实例：缓存状态在模块内，新实例等同一次重启。 */
  const freshCache = (): typeof Cache => {
    delete require.cache[require.resolve('./sparkleNodeQualityCache')]
    return require('./sparkleNodeQualityCache') as typeof Cache
  }

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sparkle-node-quality-'))
    mock.module('../utils/dirs', { exports: { dataDir: () => dataDir } })
    mock.module('fs/promises', {
      exports: {
        readFile: realReadFile,
        writeFile: ((...args: Parameters<WriteFile>) => writeHook(...args)) as WriteFile
      }
    })
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    dataDir = path.join(root, 'data')
    rmSync(dataDir, { recursive: true, force: true })
    mkdirSync(dataDir, { recursive: true })
    writeHook = realWriteFile
    cache = freshCache()
  })

  afterEach(() => {
    mock.timers.reset()
  })

  it('starts empty when there is no record file', async () => {
    assert.equal((await cache.loadSunkNodeNames(NOW)).size, 0)
  })

  it('loads records still inside their TTL and drops expired or malformed ones', async () => {
    writeFileSync(
      recordFile(),
      JSON.stringify({
        fresh: NOW - 1000,
        justInsideTtl: NOW - SINK_TTL_MS + 1,
        atTtl: NOW - SINK_TTL_MS,
        text: 'yesterday',
        numericText: String(NOW - 1000),
        nothing: null,
        nested: { sunkAt: NOW }
      })
    )

    assert.deepEqual([...(await cache.loadSunkNodeNames(NOW))].sort(), ['fresh', 'justInsideTtl'])
  })

  it('does not let a record with an absurd timestamp stay sunk forever', async () => {
    writeFileSync(recordFile(), `{"forever": 1e999, "fresh": ${NOW - 1000}}`)

    assert.deepEqual([...(await cache.loadSunkNodeNames(NOW))], ['fresh'])
  })

  it('treats an unreadable record file as empty', async () => {
    writeFileSync(recordFile(), '{not json')

    assert.equal((await cache.loadSunkNodeNames(NOW)).size, 0)
  })

  it('remembers what was marked, and persists it for the next run', async () => {
    await cache.markNodesSunk(['台湾-1', '日本-2'], NOW)

    assert.deepEqual([...(await cache.loadSunkNodeNames(NOW))].sort(), ['台湾-1', '日本-2'])
    assert.deepEqual(JSON.parse(readFileSync(recordFile(), 'utf8')), {
      '台湾-1': NOW,
      '日本-2': NOW
    })
    assert.deepEqual([...(await freshCache().loadSunkNodeNames(NOW))].sort(), ['台湾-1', '日本-2'])
  })

  it('lets a mark lapse exactly when its TTL is over', async () => {
    await cache.markNodesSunk(['台湾-1'], NOW)

    assert.deepEqual([...(await cache.loadSunkNodeNames(NOW + SINK_TTL_MS - 1))], ['台湾-1'])
    assert.equal((await cache.loadSunkNodeNames(NOW + SINK_TTL_MS)).size, 0)
  })

  it('restarts the clock when a node is marked again', async () => {
    await cache.markNodesSunk(['台湾-1'], NOW)
    await cache.markNodesSunk(['台湾-1'], NOW + SINK_TTL_MS - 1000)

    assert.deepEqual([...(await cache.loadSunkNodeNames(NOW + SINK_TTL_MS + 1000))], ['台湾-1'])
  })

  it('forgets expired records when marking, in memory and on disk', async () => {
    await cache.markNodesSunk(['old'], NOW)

    await cache.markNodesSunk(['new'], NOW + SINK_TTL_MS)

    assert.deepEqual(JSON.parse(readFileSync(recordFile(), 'utf8')), { new: NOW + SINK_TTL_MS })
    assert.deepEqual([...(await cache.loadSunkNodeNames(NOW + SINK_TTL_MS))], ['new'])
  })

  it('does nothing for an empty list', async () => {
    await cache.markNodesSunk([], NOW)

    assert.equal(existsSync(recordFile()), false)
  })

  it('keeps working from memory when the record file cannot be written', async () => {
    dataDir = path.join(root, 'missing', 'dir')

    await cache.markNodesSunk(['台湾-1'], NOW)

    assert.deepEqual([...(await cache.loadSunkNodeNames(NOW))], ['台湾-1'])
    assert.equal(existsSync(recordFile()), false)
  })

  it('judges expiry by the clock when no time is given', async () => {
    mock.timers.enable({ apis: ['Date'], now: NOW })
    await cache.markNodesSunk(['台湾-1'])
    assert.deepEqual([...(await cache.loadSunkNodeNames())], ['台湾-1'])

    mock.timers.tick(SINK_TTL_MS)

    assert.equal((await cache.loadSunkNodeNames()).size, 0)
  })

  it('never lets two writes overlap, and leaves the latest snapshot on disk', async () => {
    let inFlight = 0
    let mostInFlight = 0
    let releaseFirst: () => void = () => undefined
    const firstWriteMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let writes = 0
    writeHook = (async (...args: Parameters<WriteFile>) => {
      inFlight += 1
      mostInFlight = Math.max(mostInFlight, inFlight)
      writes += 1
      try {
        if (writes === 1) {
          await firstWriteMayFinish
        }
        return await realWriteFile(...args)
      } finally {
        inFlight -= 1
      }
    }) as WriteFile

    const marking = Promise.all([
      cache.markNodesSunk(['a'], NOW),
      cache.markNodesSunk(['b'], NOW),
      cache.markNodesSunk(['c'], NOW)
    ])
    await settle()
    releaseFirst()
    await marking

    assert.equal(writes, 3)
    assert.equal(mostInFlight, 1)
    assert.deepEqual(JSON.parse(readFileSync(recordFile(), 'utf8')), { a: NOW, b: NOW, c: NOW })
  })

  it('hands out copies, not its own state', async () => {
    await cache.markNodesSunk(['台湾-1'], NOW)
    ;((await cache.loadSunkNodeNames(NOW)) as Set<string>).add('intruder')

    assert.deepEqual([...(await cache.loadSunkNodeNames(NOW))], ['台湾-1'])
  })
})
