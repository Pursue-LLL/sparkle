import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import type * as AgyCache from './sparkleAgyProbeCache'

const NOW = 1_700_000_000_000
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

const record = (
  usable: boolean,
  ageMs = 0
): { usable: boolean; rttMs: number; checkedAt: number } => ({
  usable,
  rttMs: 120,
  checkedAt: NOW - ageMs
})

describe('sparkleAgyProbeCache', () => {
  let root = ''
  let dataDir = ''
  let cache: typeof AgyCache
  const cacheFile = (): string => path.join(dataDir, 'sparkle-agy-nodes.json')

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sparkle-agy-cache-'))
    mock.module('../utils/dirs', { exports: { dataDir: () => dataDir } })
    cache = require('./sparkleAgyProbeCache') as typeof AgyCache
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    dataDir = path.join(root, 'data')
    rmSync(dataDir, { recursive: true, force: true })
    mkdirSync(dataDir, { recursive: true })
  })

  afterEach(() => {
    mock.timers.reset()
  })

  it('starts empty when there is no cache file', async () => {
    assert.equal((await cache.loadSparkleAgyProbeCache(NOW)).size, 0)
  })

  it('keeps well-formed fresh records and drops stale or malformed ones', async () => {
    writeFileSync(
      cacheFile(),
      JSON.stringify({
        usableFresh: record(true, HOUR_MS),
        usableJustInsideTtl: record(true, 12 * HOUR_MS - 1),
        usableAtTtl: record(true, 12 * HOUR_MS),
        unusableFresh: record(false, 10 * MINUTE_MS),
        unusableJustInsideTtl: record(false, 30 * MINUTE_MS - 1),
        unusableAtTtl: record(false, 30 * MINUTE_MS),
        noRtt: { usable: true, checkedAt: NOW },
        badFlag: { usable: 'yes', rttMs: 1, checkedAt: NOW },
        badTime: { usable: true, rttMs: 1, checkedAt: '2026' },
        nothing: null
      })
    )

    const loaded = await cache.loadSparkleAgyProbeCache(NOW)

    assert.deepEqual(
      [...loaded.keys()].sort(),
      ['unusableFresh', 'unusableJustInsideTtl', 'usableFresh', 'usableJustInsideTtl'].sort()
    )
  })

  it('treats an unreadable cache file as empty', async () => {
    writeFileSync(cacheFile(), '{not json')

    assert.equal((await cache.loadSparkleAgyProbeCache(NOW)).size, 0)
  })

  it('judges freshness by the clock when no time is given', async () => {
    mock.timers.enable({ apis: ['Date'], now: NOW })
    writeFileSync(
      cacheFile(),
      JSON.stringify({ stale: record(false, 31 * MINUTE_MS), fresh: record(false, MINUTE_MS) })
    )

    assert.deepEqual([...(await cache.loadSparkleAgyProbeCache()).keys()], ['fresh'])
  })

  it('saves records so that they load back', async () => {
    const saved = record(true, MINUTE_MS)

    await cache.saveSparkleAgyProbeCache(new Map([['台湾-1|ss|tw1.example.com|443', saved]]))

    assert.deepEqual(JSON.parse(readFileSync(cacheFile(), 'utf8')), {
      '台湾-1|ss|tw1.example.com|443': saved
    })
    assert.deepEqual(
      [...(await cache.loadSparkleAgyProbeCache(NOW)).entries()],
      [['台湾-1|ss|tw1.example.com|443', saved]]
    )
  })
})
