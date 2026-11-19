import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  AGY_NODE_PROVIDER_ID,
  buildAgyGroupConfig,
  buildAgyProbeSnapshot,
  buildSparkleAgyProviderDocument,
  collectEligibleAgyProxies,
  isEligibleAgyNode,
  orderAgyProxies,
  type AgyNodeProbeRecord
} from './sparkleAgyProviderCore'
import { NODES, REGION_PRIORITY, cacheOf, names, record, vmess } from './sparkleAgyProviderFixtures'

describe('isEligibleAgyNode', () => {
  it('accepts named nodes of any protocol and rejects nameless and Hong Kong nodes', () => {
    assert.equal(isEligibleAgyNode(NODES[0]!), true)
    assert.equal(isEligibleAgyNode({ type: 'vmess', server: 'a.example', port: 1 }), false)
    assert.equal(isEligibleAgyNode({ name: '  ', type: 'vmess' }), false)
    assert.equal(isEligibleAgyNode(NODES[5]!), true)
    assert.equal(isEligibleAgyNode(NODES[4]!), false)
  })
})

describe('collectEligibleAgyProxies', () => {
  it('drops Hong Kong nodes and duplicate names, keeping every protocol', () => {
    const result = collectEligibleAgyProxies([
      ...NODES,
      { name: '美国LA-优化2-GPT', type: 'vmess', server: 'duplicate.example', port: 1 },
      { name: '  ', type: 'vmess', server: 'blank.example', port: 2 }
    ])
    assert.deepEqual(names(result), [
      '新加坡-优化2-GPT',
      '美国LA-优化2-GPT',
      '美国LA-优化3-GPT',
      '🇯🇵 日本 02',
      '🇹🇼 台湾 01'
    ])
  })
})

describe('orderAgyProxies', () => {
  it('keeps only verified-usable nodes once the probe cache has a verdict', () => {
    const cache = new Map<string, AgyNodeProbeRecord>([
      [computeProxyNodeFingerprint(NODES[0]!), record(false, 120)],
      [computeProxyNodeFingerprint(NODES[1]!), record(true, 640)],
      [computeProxyNodeFingerprint(NODES[2]!), record(true, 480)],
      [computeProxyNodeFingerprint(NODES[3]!), record(false, 90)]
    ])

    assert.deepEqual(names(orderAgyProxies(NODES, REGION_PRIORITY, cache)), [
      '美国LA-优化3-GPT',
      '美国LA-优化2-GPT'
    ])
  })

  it('cold start keeps every non-HK candidate (provider must never be empty)', () => {
    assert.deepEqual(names(orderAgyProxies(NODES, REGION_PRIORITY)), [
      '🇹🇼 台湾 01',
      '🇯🇵 日本 02',
      '新加坡-优化2-GPT',
      '美国LA-优化2-GPT',
      '美国LA-优化3-GPT'
    ])
  })

  it('orders by region priority then by measured rtt inside the region', () => {
    const cache = new Map<string, AgyNodeProbeRecord>([
      [computeProxyNodeFingerprint(NODES[0]!), record(true, 300)],
      [computeProxyNodeFingerprint(NODES[1]!), record(true, 900)],
      [computeProxyNodeFingerprint(NODES[2]!), record(true, 500)],
      [computeProxyNodeFingerprint(NODES[3]!), record(true, 700)]
    ])

    assert.deepEqual(names(orderAgyProxies(NODES, REGION_PRIORITY, cache)), [
      '🇯🇵 日本 02',
      '新加坡-优化2-GPT',
      '美国LA-优化3-GPT',
      '美国LA-优化2-GPT'
    ])
  })

  it('keeps a lone eligible node, cold or verified', () => {
    const lone = vmess('日本-A')

    assert.deepEqual(names(orderAgyProxies([lone], REGION_PRIORITY)), ['日本-A'])
    assert.deepEqual(
      names(orderAgyProxies([lone], REGION_PRIORITY, cacheOf([[lone, record(true, 100)]]))),
      ['日本-A']
    )
  })

  it('returns nothing when no node is eligible', () => {
    assert.deepEqual(orderAgyProxies([NODES[4]!], REGION_PRIORITY), [])
  })

  it('appends nodes of unlisted regions after every listed region, verified or not', () => {
    const jp = vmess('日本-A')
    const de = vmess('德国-A')
    const verified = cacheOf([
      [jp, record(true, 500)],
      [de, record(true, 100)]
    ])

    assert.deepEqual(names(orderAgyProxies([de, jp], REGION_PRIORITY)), ['日本-A', '德国-A'])
    assert.deepEqual(names(orderAgyProxies([de, jp], REGION_PRIORITY, verified)), [
      '日本-A',
      '德国-A'
    ])
  })

  it('keeps subscription order inside a region while every node is confirmed unusable', () => {
    const slow = vmess('日本-A')
    const fast = vmess('日本-B')
    const cache = cacheOf([
      [slow, record(false, 900)],
      [fast, record(false, 100)]
    ])

    assert.deepEqual(names(orderAgyProxies([slow, fast], REGION_PRIORITY, cache)), [
      '日本-A',
      '日本-B'
    ])
  })

  it('narrows the fallback pool to a single node that is not confirmed unusable', () => {
    const rejected = vmess('日本-A')
    const untested = vmess('日本-B')

    assert.deepEqual(
      names(
        orderAgyProxies(
          [rejected, untested],
          REGION_PRIORITY,
          cacheOf([[rejected, record(false, 90)]])
        )
      ),
      ['日本-B']
    )
  })

  it('falls back to the whole pool when every node is confirmed unusable', () => {
    const cache = new Map<string, AgyNodeProbeRecord>(
      NODES.map((node) => [computeProxyNodeFingerprint(node), record(false, 100)])
    )

    const result = names(orderAgyProxies(NODES, REGION_PRIORITY, cache))
    assert.equal(result.length, 5)
    assert.ok(!result.includes('🇭🇰 香港 01'))
    assert.ok(result.includes('🇹🇼 台湾 01'))
  })
})

describe('buildAgyProbeSnapshot', () => {
  it('exposes only usable nodes with rtt and checkedAt for the proxy page', () => {
    const cache = new Map<string, AgyNodeProbeRecord>([
      [computeProxyNodeFingerprint(NODES[0]!), record(true, 3200)],
      [computeProxyNodeFingerprint(NODES[1]!), record(false, 900)],
      [computeProxyNodeFingerprint(NODES[3]!), { usable: true, rttMs: 4100, checkedAt: 2000 }]
    ])

    assert.deepEqual(buildAgyProbeSnapshot(NODES, cache), {
      '新加坡-优化2-GPT': { rttMs: 3200, checkedAt: 1000 },
      '🇯🇵 日本 02': { rttMs: 4100, checkedAt: 2000 }
    })
  })

  it('returns no samples when the cache is empty or missing', () => {
    assert.deepEqual(buildAgyProbeSnapshot(NODES, undefined), {})
    assert.deepEqual(buildAgyProbeSnapshot(NODES, new Map()), {})
  })
})

describe('buildSparkleAgyProviderDocument', () => {
  it('wraps the ordered node list in a provider document', () => {
    const document = buildSparkleAgyProviderDocument({
      proxies: NODES,
      regionPriority: REGION_PRIORITY
    })
    assert.equal(document.proxies.length, 5)
  })
})

describe('buildAgyGroupConfig', () => {
  it('uses the sparkle-agy provider as a select group in provider mode', () => {
    assert.deepEqual(buildAgyGroupConfig(['任何节点'], 'profile-1'), {
      name: AGY_DEDICATED_GROUP_NAME,
      type: 'select',
      use: [AGY_NODE_PROVIDER_ID]
    })
  })

  it('falls back to flat leaf names without a provider profile', () => {
    const group = buildAgyGroupConfig(['🇯🇵 日本 02', '🇭🇰 香港 01', '  '], undefined)
    assert.deepEqual(group, {
      name: AGY_DEDICATED_GROUP_NAME,
      type: 'select',
      proxies: ['🇯🇵 日本 02']
    })
  })

  it('returns null when no eligible leaf exists', () => {
    assert.equal(buildAgyGroupConfig(['🇭🇰 香港 01'], undefined), null)
  })

  it('returns null in provider mode when the profile has no leaf at all', () => {
    assert.equal(buildAgyGroupConfig([], 'profile-1'), null)
  })
})
