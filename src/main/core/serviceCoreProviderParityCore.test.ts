import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectProxyProviderIds,
  collectRunningProxyProviderIds,
  formatProviderParityMismatchLog,
  resolveExpectedProxyProviderIds,
  shouldRestartServiceCoreForProviderParity
} from './serviceCoreProviderParityCore'

describe('serviceCoreProviderParityCore', () => {
  it('collectProxyProviderIds returns sorted keys', () => {
    assert.deepEqual(
      collectProxyProviderIds({
        'proxy-providers': {
          '77caf1sub001-vps': {},
          '77caf1sub001': {}
        }
      }),
      ['77caf1sub001', '77caf1sub001-vps']
    )
  })

  it('collectRunningProxyProviderIds excludes Compatible vehicle type', () => {
    assert.deepEqual(
      collectRunningProxyProviderIds({
        COMPATIBLE: { vehicleType: 'Compatible' },
        '678a1sub001': { vehicleType: 'File' }
      }),
      ['678a1sub001']
    )
  })

  it('shouldRestartServiceCoreForProviderParity detects subscription switch', () => {
    assert.equal(
      shouldRestartServiceCoreForProviderParity(['77caf1sub001', '77caf1sub001-vps'], {
        '678a1sub001': { vehicleType: 'File' },
        '678a1sub001-vps': { vehicleType: 'File' }
      }),
      true
    )
  })

  it('shouldRestartServiceCoreForProviderParity is false when sets match', () => {
    assert.equal(
      shouldRestartServiceCoreForProviderParity(['77caf1sub001'], {
        '77caf1sub001': { vehicleType: 'File' }
      }),
      false
    )
  })

  it('formatProviderParityMismatchLog renders both sides', () => {
    assert.equal(
      formatProviderParityMismatchLog(['77caf1sub001'], ['678a1sub001']),
      'expected=[77caf1sub001] running=[678a1sub001]'
    )
  })

  it('collectProxyProviderIds has nothing to report for missing or malformed providers', () => {
    assert.deepEqual(collectProxyProviderIds(null), [])
    assert.deepEqual(collectProxyProviderIds(undefined), [])
    assert.deepEqual(collectProxyProviderIds({}), [])
    assert.deepEqual(
      collectProxyProviderIds({ 'proxy-providers': 'oops' as unknown as Record<string, unknown> }),
      []
    )
  })

  it('collectRunningProxyProviderIds sorts and tolerates a missing provider map', () => {
    assert.deepEqual(collectRunningProxyProviderIds(null), [])
    assert.deepEqual(collectRunningProxyProviderIds(undefined), [])
    assert.deepEqual(
      collectRunningProxyProviderIds({ b: { vehicleType: 'File' }, a: { vehicleType: 'HTTP' } }),
      ['a', 'b']
    )
  })

  it('shouldRestart is false for matching sets in any order and for two empty sides', () => {
    const running = { a: { vehicleType: 'File' }, b: { vehicleType: 'File' } }

    assert.equal(shouldRestartServiceCoreForProviderParity(['b', 'a'], running), false)
    assert.equal(shouldRestartServiceCoreForProviderParity([], {}), false)
    assert.equal(
      shouldRestartServiceCoreForProviderParity([], { COMPATIBLE: { vehicleType: 'Compatible' } }),
      false
    )
  })

  it('shouldRestart is true when the counts differ or the same number of ids differ', () => {
    assert.equal(shouldRestartServiceCoreForProviderParity(['a'], {}), true)
    assert.equal(
      shouldRestartServiceCoreForProviderParity([], { a: { vehicleType: 'File' } }),
      true
    )
    assert.equal(
      shouldRestartServiceCoreForProviderParity(['a', 'b'], {
        a: { vehicleType: 'File' },
        c: { vehicleType: 'File' }
      }),
      true
    )
  })

  it('formatProviderParityMismatchLog sorts both sides and prints empty ones', () => {
    assert.equal(
      formatProviderParityMismatchLog(['b', 'a'], ['d', 'c']),
      'expected=[a,b] running=[c,d]'
    )
    assert.equal(formatProviderParityMismatchLog([], []), 'expected=[] running=[]')
  })

  it('resolveExpectedProxyProviderIds trusts memory without reading the disk', async () => {
    let diskReads = 0
    const ids = await resolveExpectedProxyProviderIds({
      runtimeConfig: { 'proxy-providers': { b: {}, a: {} } },
      loadDiskRuntimeConfig: async () => {
        diskReads += 1
        return null
      }
    })

    assert.deepEqual(ids, ['a', 'b'])
    assert.equal(diskReads, 0)
  })

  it('resolveExpectedProxyProviderIds reports nothing when the disk has no config either', async () => {
    assert.deepEqual(
      await resolveExpectedProxyProviderIds({
        runtimeConfig: undefined,
        loadDiskRuntimeConfig: async () => null
      }),
      []
    )
  })

  it('resolveExpectedProxyProviderIds falls back to disk when memory empty', async () => {
    const ids = await resolveExpectedProxyProviderIds({
      runtimeConfig: { 'proxy-providers': {} },
      loadDiskRuntimeConfig: async () => ({
        'proxy-providers': {
          '77caf1sub001-vps': {},
          '77caf1sub001': {}
        }
      })
    })
    assert.deepEqual(ids, ['77caf1sub001', '77caf1sub001-vps'])
  })
})
