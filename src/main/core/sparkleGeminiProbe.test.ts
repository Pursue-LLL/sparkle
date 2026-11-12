import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertLog,
  cacheFileExists,
  cacheKey,
  cacheRecord,
  callsStarting,
  HOUR_MS,
  NODES,
  NOW,
  readCache,
  readProviderOrder,
  useGeminiRig,
  world,
  writeCache,
  writeCacheRaw
} from './sparkleGeminiProbeRig'

const TW1 = NODES[0]
const TW2 = NODES[1]

describe('sparkleGeminiProbe cache', () => {
  const gemini = useGeminiRig()

  it('starts empty when there is no cache file', async () => {
    assert.equal((await gemini().loadSparkleGeminiRegionCache(NOW)).size, 0)
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

    const cache = await gemini().loadSparkleGeminiRegionCache(NOW)

    assert.deepEqual(
      [...cache.keys()].sort(),
      ['fresh', 'justInsideEligibleTtl', 'justInsideRestrictedTtl'].sort()
    )
  })

  it('treats an unreadable cache file as empty', async () => {
    writeCacheRaw('{not json')

    assert.equal((await gemini().loadSparkleGeminiRegionCache(NOW)).size, 0)
  })

  it('serves later calls from memory and prunes the records that expired meanwhile', async () => {
    writeCache({
      eligible: cacheRecord(true),
      restricted: cacheRecord(false)
    })
    assert.equal((await gemini().loadSparkleGeminiRegionCache(NOW)).size, 2)

    const afterSevenHours = await gemini().loadSparkleGeminiRegionCache(NOW + 7 * HOUR_MS)
    assert.deepEqual([...afterSevenHours.keys()], ['eligible'])

    const afterThirteenHours = await gemini().loadSparkleGeminiRegionCache(NOW + 13 * HOUR_MS)
    assert.equal(afterThirteenHours.size, 0)
  })

  it('does not read the file again once it has been loaded', async () => {
    writeCache({ first: cacheRecord(true) })
    await gemini().loadSparkleGeminiRegionCache(NOW)

    writeCache({ second: cacheRecord(true) })

    assert.deepEqual([...(await gemini().loadSparkleGeminiRegionCache(NOW)).keys()], ['first'])
  })
})

describe('sparkleGeminiProbe blocked node names', () => {
  const gemini = useGeminiRig()

  it('is empty without any verdicts', async () => {
    assert.equal((await gemini().loadGeminiBlockedNodeNames(NODES)).size, 0)
  })

  it('names the nodes recorded as restricted, by fingerprint or by plain name', async () => {
    writeCache({
      [cacheKey(TW2)]: cacheRecord(false),
      '日本-1': cacheRecord(false, 'CN'),
      [cacheKey(TW1)]: cacheRecord(true)
    })

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames(NODES))].sort(), [
      '台湾-2',
      '日本-1'
    ])
  })

  it('looks up the nodes of the current profile when none are given', async () => {
    writeCache({ [cacheKey(TW2)]: cacheRecord(false) })

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames())], ['台湾-2'])
  })

  it('falls back to the plain names in the cache when the profile cannot be used', async () => {
    writeCache({ '台湾-2': cacheRecord(false), '日本-1': cacheRecord(true) })
    world.profile = { current: 'default' }

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames())], ['台湾-2'])
  })

  it('falls back the same way when the profile config cannot be read', async () => {
    writeCache({ '台湾-2': cacheRecord(false) })
    world.profileError = true

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames())], ['台湾-2'])
  })

  it('falls back the same way when it is given no nodes at all', async () => {
    writeCache({ '台湾-2': cacheRecord(false) })

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames([]))], ['台湾-2'])
  })

  it('recovers names from fingerprints when there are no plain names', async () => {
    writeCache({
      [cacheKey({ name: 'a|b', type: 'ss', server: 's', port: 443 })]: cacheRecord(false),
      [cacheKey(TW1)]: cacheRecord(true)
    })
    world.profile = { current: 'default' }

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames())], ['a|b'])
  })

  it('prefers plain names over fingerprints in the fallback', async () => {
    writeCache({ '台湾-2': cacheRecord(false), [cacheKey(TW1)]: cacheRecord(false) })
    world.profile = { current: 'default' }

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames())], ['台湾-2'])
  })
})

describe('sparkleGeminiProbe verifyNodeGeminiRegion', () => {
  const gemini = useGeminiRig()

  it('answers a blank name without probing', async () => {
    assert.deepEqual(await gemini().verifyNodeGeminiRegion('   '), {
      eligible: true,
      definitive: false
    })
    assert.deepEqual(callsStarting('lock:'), [])
  })

  it('answers from the cache by fingerprint, or by plain name, without probing', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(true, 'TW'), '日本-1': cacheRecord(false, 'CN') })

    assert.deepEqual(await gemini().verifyNodeGeminiRegion('台湾-1'), {
      eligible: true,
      countryCode: 'TW',
      definitive: true
    })
    assert.deepEqual(await gemini().verifyNodeGeminiRegion('日本-1'), {
      eligible: false,
      countryCode: 'CN',
      definitive: true
    })
    assert.deepEqual(callsStarting('lock:'), [])
  })

  it('probes an unknown node inside the shared channel lock and remembers an eligible verdict', async () => {
    world.verdictOf = () => ({ definitive: true, eligible: true, countryCode: 'TW' })

    const verdict = await gemini().verifyNodeGeminiRegion(' 台湾-1 ')

    assert.deepEqual(verdict, { eligible: true, countryCode: 'TW', definitive: true })
    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1'])
    const record = { eligible: true, countryCode: 'TW', checkedAt: NOW }
    assert.deepEqual(readCache(), { [cacheKey(TW1)]: record, '台湾-1': record })
    assertLog('verified eligible node "台湾-1" (region=TW)')

    await gemini().verifyNodeGeminiRegion('台湾-1')
    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1'], 'the second ask is a cache hit')
  })

  it('keys a node that is not in the profile by its plain name only', async () => {
    world.verdictOf = () => ({ definitive: true, eligible: true, countryCode: 'JP' })

    await gemini().verifyNodeGeminiRegion('mystery')

    assert.deepEqual(Object.keys(readCache()), ['mystery'])
  })

  it('evicts a restricted node: remembers it, rebuilds sparkle-fast and reloads mihomo', async () => {
    world.verdictOf = () => ({ definitive: true, eligible: false, countryCode: 'ZZ' })

    const verdict = await gemini().verifyNodeGeminiRegion('台湾-1')

    assert.deepEqual(verdict, { eligible: false, countryCode: 'ZZ', definitive: true })
    assert.equal(readCache()[cacheKey(TW1)].eligible, false)
    assertLog('evicted region-restricted node "台湾-1" (region=ZZ)')
    assert.deepEqual(readProviderOrder(), ['台湾-2', '日本-1'])
    assert.deepEqual(callsStarting('update:'), ['update:sparkle-fast'])
  })

  it('leaves the provider alone when the caller will rebuild it once for a batch', async () => {
    world.verdictOf = () => ({ definitive: true, eligible: false, countryCode: 'ZZ' })

    await gemini().verifyNodeGeminiRegion('台湾-1', { skipProviderReloadOnReject: true })

    assert.equal(readCache()[cacheKey(TW1)].eligible, false)
    assert.equal(readProviderOrder(), undefined)
    assert.deepEqual(callsStarting('update:'), [])
  })

  it('does not remember a probe without a verdict, so a timeout never locks a node out', async () => {
    world.verdictOf = () => ({ definitive: false, eligible: false })

    assert.deepEqual(await gemini().verifyNodeGeminiRegion('台湾-1'), {
      eligible: true,
      definitive: false
    })
    assert.equal(cacheFileExists(), false)
  })

  it('does not accept a verdict that names no region', async () => {
    world.verdictOf = () => ({ definitive: true, eligible: false })

    assert.deepEqual(await gemini().verifyNodeGeminiRegion('台湾-1'), {
      eligible: true,
      definitive: false
    })
    assert.equal(cacheFileExists(), false)
  })

  it('treats a probe that throws as no verdict', async () => {
    world.probeFailure = { reason: new Error('socket hang up') }

    assert.deepEqual(await gemini().verifyNodeGeminiRegion('台湾-1'), {
      eligible: true,
      definitive: false
    })
    assert.equal(cacheFileExists(), false)
  })
})
