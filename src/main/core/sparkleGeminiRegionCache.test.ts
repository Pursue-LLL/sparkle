import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertLog,
  cacheRecord,
  dataFileNames,
  DAY_MS,
  HOUR_MS,
  NOW,
  readCache,
  regionCache,
  removeDataDir,
  useGeminiRig,
  writeCache,
  writeCacheRaw
} from './sparkleGeminiProbeRig'

describe('sparkleGeminiRegionCache load', () => {
  useGeminiRig()

  it('starts empty when there is no cache file', async () => {
    assert.equal((await regionCache().loadSparkleGeminiRegionCache(NOW)).size, 0)
  })

  it('keeps well-formed fresh records and drops stale or malformed ones', async () => {
    writeCache({
      fresh: cacheRecord(true, 'TW', HOUR_MS),
      justInsideEligibleTtl: cacheRecord(true, 'TW', 12 * HOUR_MS - 1),
      atEligibleTtl: cacheRecord(true, 'TW', 12 * HOUR_MS),
      justInsideRestrictedTtl: cacheRecord(false, 'ZZ', 6 * HOUR_MS - 1),
      atRestrictedTtl: cacheRecord(false, 'ZZ', 6 * HOUR_MS),
      noCountry: { eligible: true, checkedAt: NOW },
      badFlag: { eligible: 'yes', countryCode: 'TW', checkedAt: NOW },
      badTime: { eligible: true, countryCode: 'TW', checkedAt: '2026' },
      nothing: null
    })

    const cache = await regionCache().loadSparkleGeminiRegionCache(NOW)

    assert.deepEqual(
      [...cache.keys()].sort(),
      ['fresh', 'justInsideEligibleTtl', 'justInsideRestrictedTtl'].sort()
    )
  })

  it('treats an unreadable cache file as empty', async () => {
    writeCacheRaw('{not json')

    assert.equal((await regionCache().loadSparkleGeminiRegionCache(NOW)).size, 0)
  })

  it('serves later calls from memory and prunes the records that expired meanwhile', async () => {
    writeCache({
      eligible: cacheRecord(true),
      restricted: cacheRecord(false)
    })
    assert.equal((await regionCache().loadSparkleGeminiRegionCache(NOW)).size, 2)

    const afterSevenHours = await regionCache().loadSparkleGeminiRegionCache(NOW + 7 * HOUR_MS)
    assert.deepEqual([...afterSevenHours.keys()], ['eligible'])

    const afterThirteenHours = await regionCache().loadSparkleGeminiRegionCache(NOW + 13 * HOUR_MS)
    assert.equal(afterThirteenHours.size, 0)
  })

  it('does not read the file again once it has been loaded', async () => {
    writeCache({ first: cacheRecord(true) })
    await regionCache().loadSparkleGeminiRegionCache(NOW)

    writeCache({ second: cacheRecord(true) })

    assert.deepEqual([...(await regionCache().loadSparkleGeminiRegionCache(NOW)).keys()], ['first'])
  })

  it('counts a timestamp from the future as now, so the record still expires on schedule', async () => {
    writeCache({ skewed: cacheRecord(true, 'TW', -5 * DAY_MS) })

    const cache = await regionCache().loadSparkleGeminiRegionCache(NOW)
    assert.equal(cache.get('skewed')?.checkedAt, NOW)

    assert.equal((await regionCache().loadSparkleGeminiRegionCache(NOW + 12 * HOUR_MS)).size, 0)
  })

  it('also clamps a timestamp that is beyond any real date', async () => {
    writeCacheRaw('{"huge":{"eligible":true,"countryCode":"TW","checkedAt":1e999}}')

    const cache = await regionCache().loadSparkleGeminiRegionCache(NOW)

    assert.equal(cache.get('huge')?.checkedAt, NOW)
  })
})

describe('sparkleGeminiRegionCache save', () => {
  useGeminiRig()

  it('replaces the file in one piece and leaves no temp file behind', async () => {
    const cache = await regionCache().loadSparkleGeminiRegionCache(NOW)
    cache.set('台湾-1', cacheRecord(true))

    await regionCache().saveSparkleGeminiRegionCache(cache)

    assert.deepEqual(readCache(), { '台湾-1': cacheRecord(true) })
    assert.deepEqual(dataFileNames(), ['sparkle-gemini-nodes.json'])
  })

  it('keeps the verdicts in memory and says so when the file cannot be written', async () => {
    const cache = await regionCache().loadSparkleGeminiRegionCache(NOW)
    cache.set('台湾-1', cacheRecord(false))
    removeDataDir()

    await regionCache().saveSparkleGeminiRegionCache(cache)

    assertLog('region cache not persisted')
    assert.equal(
      (await regionCache().loadSparkleGeminiRegionCache(NOW)).get('台湾-1')?.eligible,
      false
    )
  })
})
