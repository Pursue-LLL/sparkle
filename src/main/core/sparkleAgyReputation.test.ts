import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  buildSparkleAgyProviderDocument,
  orderAgyProxies,
  orderAgyRepairProxies,
  type AgyNodeProbeRecord,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'
import { REGION_PRIORITY, cacheOf, names, vmess } from './sparkleAgyProviderFixtures'
import {
  AGY_FLAG_MEMORY_MS,
  agyAvoidedAt,
  flagAgyNode,
  partitionByReputation
} from './sparkleAgyReputation'

const NOW = 10 * AGY_FLAG_MEMORY_MS
const HOUR_MS = 60 * 60 * 1000

const flagsOf = (entries: Array<[AgyProxyRecord, number]>): Map<string, number> =>
  new Map(entries.map(([proxy, at]) => [computeProxyNodeFingerprint(proxy), at]))

const verifiedAt = (ageMs: number, rttMs = 100): AgyNodeProbeRecord => ({
  usable: true,
  rttMs,
  checkedAt: NOW - ageMs
})

const rejectedAt = (ageMs: number): AgyNodeProbeRecord => ({
  usable: false,
  rttMs: 100,
  checkedAt: NOW - ageMs
})

describe('agyAvoidedAt', () => {
  const node = vmess('台湾-A')
  const fingerprint = computeProxyNodeFingerprint(node)

  it('has nothing to avoid for a node with no flag and no rejection', () => {
    assert.equal(agyAvoidedAt(fingerprint, undefined, undefined, NOW), undefined)
    assert.equal(
      agyAvoidedAt(fingerprint, cacheOf([[node, verifiedAt(HOUR_MS)]]), new Map(), NOW),
      undefined
    )
  })

  it('remembers a flag for 24 hours, exclusive of the 24th', () => {
    const flaggedAgo = (ageMs: number): Map<string, number> => new Map([[fingerprint, NOW - ageMs]])

    assert.equal(
      agyAvoidedAt(fingerprint, undefined, flaggedAgo(AGY_FLAG_MEMORY_MS - 1), NOW),
      NOW - AGY_FLAG_MEMORY_MS + 1
    )
    assert.equal(
      agyAvoidedAt(fingerprint, undefined, flaggedAgo(AGY_FLAG_MEMORY_MS), NOW),
      undefined
    )
  })

  it('lets a passing probe leave the flag standing', () => {
    const flags = new Map([[fingerprint, NOW - 2 * HOUR_MS]])
    const cache = cacheOf([[node, verifiedAt(60_000)]])

    assert.equal(agyAvoidedAt(fingerprint, cache, flags, NOW), NOW - 2 * HOUR_MS)
  })

  it('takes a cached rejection as an avoidance too', () => {
    const cache = cacheOf([[node, rejectedAt(10 * 60_000)]])

    assert.equal(agyAvoidedAt(fingerprint, cache, undefined, NOW), NOW - 10 * 60_000)
  })

  it('uses the more recent of the flag and the cached rejection', () => {
    const cache = cacheOf([[node, rejectedAt(10 * 60_000)]])

    assert.equal(
      agyAvoidedAt(fingerprint, cache, new Map([[fingerprint, NOW - HOUR_MS]]), NOW),
      NOW - 10 * 60_000
    )
    assert.equal(
      agyAvoidedAt(fingerprint, cache, new Map([[fingerprint, NOW - 60_000]]), NOW),
      NOW - 60_000
    )
  })
})

describe('flagAgyNode', () => {
  it('records the time of the latest judgement', () => {
    const flags = new Map<string, number>()

    flagAgyNode(flags, 'node', NOW - HOUR_MS)
    flagAgyNode(flags, 'node', NOW)

    assert.deepEqual([...flags], [['node', NOW]])
  })
})

describe('partitionByReputation', () => {
  it('keeps clean nodes in order and puts the longest-ago judged node first among the avoided', () => {
    const [a, b, c, d, e] = ['台湾-A', '台湾-B', '日本-A', '日本-B', '美国-A'].map(vmess)
    const flags = flagsOf([
      [b, NOW - HOUR_MS],
      [d, NOW - 3 * HOUR_MS],
      [e, NOW - 2 * HOUR_MS]
    ])

    const { clean, avoided } = partitionByReputation([a, b, c, d, e], undefined, flags, NOW)

    assert.deepEqual(names(clean), ['台湾-A', '日本-A'])
    assert.deepEqual(names(avoided), ['日本-B', '美国-A', '台湾-B'])
  })

  it('keeps the incoming order for nodes judged at the same moment', () => {
    const [a, b, c] = ['台湾-A', '台湾-B', '台湾-C'].map(vmess)
    const flags = flagsOf([
      [c, NOW - HOUR_MS],
      [a, NOW - HOUR_MS],
      [b, NOW - HOUR_MS]
    ])

    assert.deepEqual(names(partitionByReputation([a, b, c], undefined, flags, NOW).avoided), [
      '台湾-A',
      '台湾-B',
      '台湾-C'
    ])
  })

  it('treats an expired flag as clean', () => {
    const a = vmess('台湾-A')
    const flags = flagsOf([[a, NOW - AGY_FLAG_MEMORY_MS]])

    assert.deepEqual(names(partitionByReputation([a], undefined, flags, NOW).clean), ['台湾-A'])
  })
})

describe('orderAgyRepairProxies with flags', () => {
  const tw = vmess('台湾-A')
  const twSecond = vmess('台湾-B')
  const jp = vmess('日本-A')
  const us = vmess('美国-A')
  const pool = [tw, twSecond, jp, us]

  it('moves a flagged top-region node behind every clean node', () => {
    const flags = flagsOf([[tw, NOW - HOUR_MS]])

    assert.deepEqual(
      names(orderAgyRepairProxies(pool, REGION_PRIORITY, undefined, 10, NOW, undefined, flags)),
      ['台湾-B', '日本-A', '美国-A', '台湾-A']
    )
  })

  it('tries the longest-ago flagged node first once the clean ones are used up', () => {
    const flags = flagsOf([
      [tw, NOW - HOUR_MS],
      [jp, NOW - 5 * HOUR_MS]
    ])

    assert.deepEqual(
      names(orderAgyRepairProxies(pool, REGION_PRIORITY, undefined, 10, NOW, undefined, flags)),
      ['台湾-B', '美国-A', '日本-A', '台湾-A']
    )
  })

  it('does not let a recent attempt lift a flagged node above clean ones', () => {
    const flags = flagsOf([[tw, NOW - HOUR_MS]])
    const attempted = new Map([[computeProxyNodeFingerprint(twSecond), NOW - 60_000]])

    assert.deepEqual(
      names(orderAgyRepairProxies(pool, REGION_PRIORITY, undefined, 10, NOW, attempted, flags)),
      ['日本-A', '美国-A', '台湾-B', '台湾-A']
    )
  })

  it('forgets a flag after 24 hours', () => {
    const flags = flagsOf([[tw, NOW - AGY_FLAG_MEMORY_MS]])

    assert.deepEqual(
      names(orderAgyRepairProxies(pool, REGION_PRIORITY, undefined, 10, NOW, undefined, flags)),
      ['台湾-A', '台湾-B', '日本-A', '美国-A']
    )
  })

  it('judges a cached rejection and a flag on the same node as one avoidance', () => {
    const cache = cacheOf([[tw, rejectedAt(10 * 60_000)]])
    const flags = flagsOf([[jp, NOW - HOUR_MS]])

    assert.deepEqual(
      names(orderAgyRepairProxies(pool, REGION_PRIORITY, cache, 10, NOW, undefined, flags)),
      ['台湾-B', '美国-A', '日本-A', '台湾-A']
    )
  })

  it('keeps flagged nodes inside the probe limit only after the clean ones', () => {
    const flags = flagsOf([[tw, NOW - HOUR_MS]])

    assert.deepEqual(
      names(orderAgyRepairProxies(pool, REGION_PRIORITY, undefined, 2, NOW, undefined, flags)),
      ['台湾-B', '日本-A']
    )
  })
})

describe('orderAgyProxies with flags', () => {
  const fastTaiwan = vmess('台湾-快')
  const slowTaiwan = vmess('台湾-慢')
  const japan = vmess('日本-A')

  it('demotes a flagged verified node even when it is the fastest in the top region', () => {
    const cache = cacheOf([
      [fastTaiwan, verifiedAt(60_000, 100)],
      [slowTaiwan, verifiedAt(60_000, 900)],
      [japan, verifiedAt(60_000, 300)]
    ])
    const flags = flagsOf([[fastTaiwan, NOW - HOUR_MS]])

    assert.deepEqual(
      names(orderAgyProxies([fastTaiwan, slowTaiwan, japan], REGION_PRIORITY, cache, flags, NOW)),
      ['台湾-慢', '日本-A', '台湾-快']
    )
  })

  it('keeps a flagged node a member of the provider, only last', () => {
    const cache = cacheOf([[fastTaiwan, verifiedAt(60_000)]])
    const flags = flagsOf([[fastTaiwan, NOW - HOUR_MS]])

    assert.deepEqual(names(orderAgyProxies([fastTaiwan], REGION_PRIORITY, cache, flags, NOW)), [
      '台湾-快'
    ])
  })

  it('orders an all-flagged pool by the longest-ago judgement', () => {
    const cache = cacheOf([
      [fastTaiwan, verifiedAt(60_000, 100)],
      [japan, verifiedAt(60_000, 100)]
    ])
    const flags = flagsOf([
      [fastTaiwan, NOW - HOUR_MS],
      [japan, NOW - 6 * HOUR_MS]
    ])

    assert.deepEqual(
      names(orderAgyProxies([fastTaiwan, japan], REGION_PRIORITY, cache, flags, NOW)),
      ['日本-A', '台湾-快']
    )
  })

  it('leaves the region order alone when every node is confirmed unusable and none is flagged', () => {
    const cache = cacheOf([
      [japan, rejectedAt(20 * 60_000)],
      [fastTaiwan, rejectedAt(5 * 60_000)]
    ])

    assert.deepEqual(
      names(orderAgyProxies([japan, fastTaiwan], REGION_PRIORITY, cache, new Map(), NOW)),
      ['台湾-快', '日本-A']
    )
  })

  it('puts the flag-aware order into the provider document', () => {
    const cache = cacheOf([
      [fastTaiwan, verifiedAt(60_000, 100)],
      [japan, verifiedAt(60_000, 300)]
    ])
    const flags = flagsOf([[fastTaiwan, Date.now() - HOUR_MS]])

    const document = buildSparkleAgyProviderDocument({
      proxies: [fastTaiwan, japan],
      regionPriority: REGION_PRIORITY,
      probeCache: cache,
      flags
    })

    assert.deepEqual(names(document.proxies), ['日本-A', '台湾-快'])
  })
})
