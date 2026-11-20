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
  readLedger,
  readProviderOrder,
  UNUSABLE_PROFILES,
  useGeminiRig,
  world,
  writeCache
} from './sparkleGeminiProbeRig'

const TW1 = NODES[0]
const TW2 = NODES[1]

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

  it('does not look at the profile when nothing is cached', async () => {
    assert.equal((await gemini().loadGeminiBlockedNodeNames()).size, 0)
    assert.equal(world.profileReads, 0)
  })

  it('judges by the nodes it is given, not by the current profile', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(false) })
    world.profileProxies = [TW2]

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames([TW1]))], ['台湾-1'])
    assert.equal(world.profileReads, 0)
  })

  it('does not block a node whose server changed since it was rejected', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(false) })
    world.profileProxies = [{ ...TW1, server: 'moved.example.com' }]

    assert.equal((await gemini().loadGeminiBlockedNodeNames()).size, 0)
  })

  for (const [label, apply] of UNUSABLE_PROFILES) {
    it(`falls back to the plain names in the cache when the ${label}`, async () => {
      writeCache({ '台湾-2': cacheRecord(false), '日本-1': cacheRecord(true) })
      apply()

      assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames())], ['台湾-2'])
    })
  }

  it('falls back the same way when it is given no nodes at all', async () => {
    writeCache({ '台湾-2': cacheRecord(false) })

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames([]))], ['台湾-2'])
  })

  it('recovers names from fingerprints when there are no plain names', async () => {
    writeCache({
      [cacheKey({ name: 'a|b', type: 'ss', server: 's', port: 443 })]: cacheRecord(false),
      [cacheKey(TW2)]: cacheRecord(false),
      [cacheKey({ type: 'ss', server: 's', port: 443 })]: cacheRecord(false),
      [cacheKey(TW1)]: cacheRecord(true)
    })
    world.profile = { current: 'default' }

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames())].sort(), ['a|b', '台湾-2'])
  })

  it('keeps a plain node name that itself contains a bar', async () => {
    writeCache({ 'x|y': cacheRecord(false) })
    world.profile = { current: 'default' }

    assert.deepEqual([...(await gemini().loadGeminiBlockedNodeNames())], ['x|y'])
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

  for (const [label, apply] of UNUSABLE_PROFILES) {
    it(`keys the verdict by the plain name when the ${label}`, async () => {
      apply()
      world.verdictOf = () => ({ definitive: true, eligible: true, countryCode: 'TW' })

      const verdict = await gemini().verifyNodeGeminiRegion('台湾-1')

      assert.deepEqual(verdict, { eligible: true, countryCode: 'TW', definitive: true })
      assert.deepEqual(Object.keys(readCache()), ['台湾-1'])
    })
  }

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

  it('serves a record younger than maxAgeMs from the cache and probes again for an older one', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(true, 'TW', 2 * HOUR_MS) })
    world.verdictOf = () => ({ definitive: true, eligible: true, countryCode: 'JP' })

    const young = await gemini().verifyNodeGeminiRegion('台湾-1', { maxAgeMs: 3 * HOUR_MS })
    assert.deepEqual(young, { eligible: true, countryCode: 'TW', definitive: true })
    assert.deepEqual(callsStarting('lock:'), [])

    const old = await gemini().verifyNodeGeminiRegion('台湾-1', { maxAgeMs: 2 * HOUR_MS })
    assert.deepEqual(old, { eligible: true, countryCode: 'JP', definitive: true })
    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1'])
    assert.equal(readCache()[cacheKey(TW1)].countryCode, 'JP')
  })

  it('keeps the old record when the fresh probe has no verdict', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(true, 'TW', 2 * HOUR_MS) })
    world.verdictOf = () => ({ definitive: false, eligible: false })

    const verdict = await gemini().verifyNodeGeminiRegion('台湾-1', { maxAgeMs: HOUR_MS })

    assert.deepEqual(verdict, { eligible: true, definitive: false })
    assert.deepEqual(readCache(), { [cacheKey(TW1)]: cacheRecord(true, 'TW', 2 * HOUR_MS) })
  })
})

describe('sparkleGeminiProbe verdict bookkeeping', () => {
  const gemini = useGeminiRig()

  it('counts an eligible verdict as one good sample', async () => {
    world.verdictOf = () => ({ definitive: true, eligible: true, countryCode: 'TW' })

    await gemini().verifyNodeGeminiRegion('台湾-1')

    assert.deepEqual(readLedger(), { '台湾-1': { samples: 1 } })
  })

  it('counts a restricted verdict as a sample stamped with the time of the failure', async () => {
    world.verdictOf = () => ({ definitive: true, eligible: false, countryCode: 'ZZ' })

    await gemini().verifyNodeGeminiRegion('台湾-1')

    assert.deepEqual(readLedger(), { '台湾-1': { samples: 1, lastBadAt: NOW } })
  })

  it('counts every fresh probe of the same node', async () => {
    world.verdictOf = () => ({ definitive: true, eligible: true, countryCode: 'TW' })
    writeCache({ [cacheKey(TW1)]: cacheRecord(true, 'TW', 2 * HOUR_MS) })

    await gemini().verifyNodeGeminiRegion('台湾-1', { maxAgeMs: HOUR_MS })
    await gemini().verifyNodeGeminiRegion('台湾-1', { maxAgeMs: 0 })

    assert.deepEqual(readLedger(), { '台湾-1': { samples: 2 } })
  })

  it('does not count an answer served from the cache', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(true) })

    await gemini().verifyNodeGeminiRegion('台湾-1')

    assert.throws(readLedger, { code: 'ENOENT' })
  })

  it('does not count a probe that reached no verdict', async () => {
    world.verdictOf = () => ({ definitive: false, eligible: false })

    await gemini().verifyNodeGeminiRegion('台湾-1')

    assert.throws(readLedger, { code: 'ENOENT' })
  })
})
