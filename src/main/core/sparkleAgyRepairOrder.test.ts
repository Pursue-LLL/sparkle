import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  orderAgyRepairProxies,
  type AgyNodeProbeRecord,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'
import { NODES, REGION_PRIORITY, cacheOf, names, record, vmess } from './sparkleAgyProviderFixtures'

describe('orderAgyRepairProxies', () => {
  it('orders strictly by region priority (Taiwan first), same as 自动选择', () => {
    const strictNodes: AgyProxyRecord[] = [
      { name: '台湾-A', type: 'vmess', server: 'tw.a.example', port: 1 },
      { name: '台湾-B', type: 'vmess', server: 'tw.b.example', port: 2 },
      { name: '日本-A', type: 'vmess', server: 'jp.a.example', port: 3 }
    ]
    assert.deepEqual(names(orderAgyRepairProxies(strictNodes, REGION_PRIORITY, undefined, 10)), [
      '台湾-A',
      '台湾-B',
      '日本-A'
    ])
  })

  it('pushes a confirmed-unusable top-region node behind every other region', () => {
    const strictNodes: AgyProxyRecord[] = [
      { name: '台湾-A', type: 'vmess', server: 'tw.a.example', port: 1 },
      { name: '台湾-B', type: 'vmess', server: 'tw.b.example', port: 2 },
      { name: '日本-A', type: 'vmess', server: 'jp.a.example', port: 3 }
    ]
    const cache = new Map<string, AgyNodeProbeRecord>([
      [computeProxyNodeFingerprint(strictNodes[0]!), record(false, 120)]
    ])
    assert.deepEqual(names(orderAgyRepairProxies(strictNodes, REGION_PRIORITY, cache, 10)), [
      '台湾-B',
      '日本-A',
      '台湾-A'
    ])
  })

  it('defers recently attempted nodes so the next repair reaches untried candidates', () => {
    const strictNodes: AgyProxyRecord[] = [
      { name: '台湾-A', type: 'vmess', server: 'tw.a.example', port: 1 },
      { name: '台湾-B', type: 'vmess', server: 'tw.b.example', port: 2 },
      { name: '日本-A', type: 'vmess', server: 'jp.a.example', port: 3 }
    ]
    const now = 1_000_000
    const attempted = new Map<string, number>([
      [computeProxyNodeFingerprint(strictNodes[0]!), now - 60_000],
      [computeProxyNodeFingerprint(strictNodes[1]!), now - 60_000]
    ])
    assert.deepEqual(
      names(orderAgyRepairProxies(strictNodes, REGION_PRIORITY, undefined, 10, now, attempted)),
      ['日本-A', '台湾-A', '台湾-B']
    )
  })

  it('forgets attempts older than the 15-minute window', () => {
    const strictNodes: AgyProxyRecord[] = [
      { name: '台湾-A', type: 'vmess', server: 'tw.a.example', port: 1 },
      { name: '台湾-B', type: 'vmess', server: 'tw.b.example', port: 2 },
      { name: '日本-A', type: 'vmess', server: 'jp.a.example', port: 3 }
    ]
    const now = 10_000_000
    const attempted = new Map<string, number>([
      [computeProxyNodeFingerprint(strictNodes[0]!), now - 16 * 60 * 1000]
    ])
    assert.deepEqual(
      names(orderAgyRepairProxies(strictNodes, REGION_PRIORITY, undefined, 10, now, attempted)),
      ['台湾-A', '台湾-B', '日本-A']
    )
  })

  it('places nodes of unlisted regions after the listed ones but before rejected nodes', () => {
    const de = vmess('德国-A')
    const jp = vmess('日本-A')
    const rejected = vmess('台湾-A')
    const cache = cacheOf([[rejected, record(false, 120)]])

    assert.deepEqual(names(orderAgyRepairProxies([de, jp, rejected], REGION_PRIORITY, cache, 10)), [
      '日本-A',
      '德国-A',
      '台湾-A'
    ])
  })

  it('ranks a record younger than 30 minutes ahead of an older one, whatever the rtt', () => {
    const young = vmess('日本-A')
    const old = vmess('日本-B')
    const now = 10_000_000
    const cache = cacheOf([
      [young, { usable: true, rttMs: 900, checkedAt: now - 1_799_999 }],
      [old, { usable: true, rttMs: 100, checkedAt: now - 1_800_000 }]
    ])

    assert.deepEqual(names(orderAgyRepairProxies([old, young], REGION_PRIORITY, cache, 10, now)), [
      '日本-A',
      '日本-B'
    ])
  })

  it('defers an attempt until it is exactly 15 minutes old', () => {
    const tw1 = vmess('台湾-A')
    const tw2 = vmess('台湾-B')
    const jp = vmess('日本-A')
    const now = 10_000_000
    const attemptedAgo = (ageMs: number): Map<string, number> =>
      new Map([[computeProxyNodeFingerprint(tw1), now - ageMs]])

    assert.deepEqual(
      names(
        orderAgyRepairProxies(
          [tw1, tw2, jp],
          REGION_PRIORITY,
          undefined,
          10,
          now,
          attemptedAgo(900_000)
        )
      ),
      ['台湾-A', '台湾-B', '日本-A']
    )
    assert.deepEqual(
      names(
        orderAgyRepairProxies(
          [tw1, tw2, jp],
          REGION_PRIORITY,
          undefined,
          10,
          now,
          attemptedAgo(899_999)
        )
      ),
      ['台湾-B', '日本-A', '台湾-A']
    )
  })

  it('keeps the existing region order for the shared fixture', () => {
    assert.deepEqual(names(orderAgyRepairProxies(NODES, REGION_PRIORITY, undefined, 10)), [
      '🇹🇼 台湾 01',
      '🇯🇵 日本 02',
      '新加坡-优化2-GPT',
      '美国LA-优化2-GPT',
      '美国LA-优化3-GPT'
    ])
  })

  it('moves confirmed-unusable nodes to the end without dropping them', () => {
    const cache = new Map<string, AgyNodeProbeRecord>([
      [computeProxyNodeFingerprint(NODES[0]!), record(false, 120)]
    ])

    assert.deepEqual(names(orderAgyRepairProxies(NODES, REGION_PRIORITY, cache, 10)), [
      '🇹🇼 台湾 01',
      '🇯🇵 日本 02',
      '美国LA-优化2-GPT',
      '美国LA-优化3-GPT',
      '新加坡-优化2-GPT'
    ])
  })

  it('prefers freshly verified nodes inside a region by rtt', () => {
    const now = 1_000_000
    const fresh = (rttMs: number): AgyNodeProbeRecord => ({
      usable: true,
      rttMs,
      checkedAt: now - 60_000
    })
    const cache = new Map<string, AgyNodeProbeRecord>([
      [computeProxyNodeFingerprint(NODES[1]!), fresh(900)],
      [computeProxyNodeFingerprint(NODES[2]!), fresh(300)]
    ])

    assert.deepEqual(names(orderAgyRepairProxies(NODES, REGION_PRIORITY, cache, 10, now)), [
      '🇹🇼 台湾 01',
      '🇯🇵 日本 02',
      '新加坡-优化2-GPT',
      '美国LA-优化3-GPT',
      '美国LA-优化2-GPT'
    ])
  })

  it('ranks older verified nodes by rtt behind fresh ones and ahead of untested ones', () => {
    const now = 10_000_000
    const usAt = (
      name: string,
      rttMs: number,
      ageMs: number
    ): [AgyProxyRecord, AgyNodeProbeRecord] => [
      vmess(name),
      { usable: true, rttMs, checkedAt: now - ageMs }
    ]
    const untested = vmess('美国-未测')
    const [slowOld, slowOldRecord] = usAt('美国-旧慢', 900, 5 * 3_600_000)
    const [fastOld, fastOldRecord] = usAt('美国-旧快', 300, 5 * 3_600_000)
    const [fresh, freshRecord] = usAt('美国-新', 500, 60_000)
    const cache = cacheOf([
      [slowOld, slowOldRecord],
      [fastOld, fastOldRecord],
      [fresh, freshRecord]
    ])

    assert.deepEqual(
      names(
        orderAgyRepairProxies([untested, slowOld, fastOld, fresh], REGION_PRIORITY, cache, 10, now)
      ),
      ['美国-新', '美国-旧快', '美国-旧慢', '美国-未测']
    )
  })

  it('honours the probe limit, drops Hong Kong nodes and never duplicates', () => {
    const result = orderAgyRepairProxies(
      [...NODES, { name: '🇭🇰 香港 01', type: 'vmess', server: 'hk.example', port: 443 }],
      REGION_PRIORITY,
      undefined,
      2
    )
    assert.deepEqual(names(result), ['🇹🇼 台湾 01', '🇯🇵 日本 02'])
    assert.ok(!names(result).includes('🇭🇰 香港 01'))
    assert.ok(names(result).includes('🇹🇼 台湾 01'))
  })

  it('returns an empty list for a non-positive limit', () => {
    assert.deepEqual(orderAgyRepairProxies(NODES, REGION_PRIORITY, undefined, 0), [])
  })
})
