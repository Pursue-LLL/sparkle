import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSparkleFastProviderDocument,
  listFlatAutoSelectProxyNames,
  orderProxiesByRegionPriority
} from './sparkleFastProviderCore'

const NODES = [
  { name: '🇹🇼 台湾 01', type: 'anytls' },
  { name: '🇹🇼 台湾 02', type: 'hysteria2' },
  { name: '🇹🇼 台湾 03', type: 'trojan' },
  { name: '🇯🇵 日本 01', type: 'anytls' },
  { name: '🇯🇵 日本 02', type: 'hysteria2' },
  { name: '🇯🇵 日本 03', type: 'trojan' },
  { name: 'KR-VPS-Reality', type: 'vless' }
]

describe('sparkleFastProviderCore', () => {
  it('orders by region priority with JP before TW, then other nodes last', () => {
    const ordered = orderProxiesByRegionPriority([...NODES], ['日本', '台湾'])
    assert.deepEqual(
      ordered.map((proxy) => proxy.name),
      [
        '🇯🇵 日本 01',
        '🇯🇵 日本 02',
        '🇯🇵 日本 03',
        '🇹🇼 台湾 01',
        '🇹🇼 台湾 02',
        '🇹🇼 台湾 03',
        'KR-VPS-Reality'
      ]
    )
  })

  it('keeps every protocol, anytls included, in its normal region position', () => {
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [...NODES],
      regionPriority: ['日本', '台湾']
    })
    const names = proxies.map((proxy) => proxy.name)
    assert.equal(names.includes('🇯🇵 日本 01'), true)
    assert.equal(names.includes('🇯🇵 日本 02'), true)
    assert.equal(names.includes('🇹🇼 台湾 01'), true)
    assert.equal(names.includes('🇹🇼 台湾 02'), true)
    assert.deepEqual(listFlatAutoSelectProxyNames([...NODES], ['日本', '台湾']), names)
  })

  it('keeps anytls nodes regardless of type spelling', () => {
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [
        { name: 'A', type: 'AnyTLS' },
        { name: 'B', type: ' anytls ' },
        { name: 'C', type: 'hysteria2' }
      ],
      regionPriority: ['台湾']
    })
    assert.deepEqual(
      proxies.map((proxy) => proxy.name),
      ['A', 'B', 'C']
    )
  })

  it('excludes Hong Kong nodes', () => {
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [
        { name: '🇭🇰 香港 01', type: 'trojan' },
        { name: '🇯🇵 日本 01', type: 'trojan' }
      ],
      regionPriority: ['日本']
    })
    assert.deepEqual(
      proxies.map((proxy) => proxy.name),
      ['🇯🇵 日本 01']
    )
  })

  it('keeps a lone anytls node instead of yielding an empty member list', () => {
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [{ name: 'A', type: 'anytls' }],
      regionPriority: ['台湾']
    })
    assert.deepEqual(
      proxies.map((proxy) => proxy.name),
      ['A']
    )
  })

  it('sorts each region segment by latency, keeping region order and placing unsampled nodes globally last', () => {
    const delays = new Map([
      ['🇯🇵 日本 03', 90],
      ['🇯🇵 日本 02', 40],
      ['🇹🇼 台湾 03', 30]
    ])
    const ordered = orderProxiesByRegionPriority([...NODES], ['台湾', '日本'], {
      delayMs: delays
    })
    assert.deepEqual(
      ordered.map((proxy) => proxy.name),
      [
        '🇹🇼 台湾 03',
        '🇯🇵 日本 02',
        '🇯🇵 日本 03',
        '🇹🇼 台湾 01',
        '🇹🇼 台湾 02',
        '🇯🇵 日本 01',
        'KR-VPS-Reality'
      ]
    )
  })

  it('keeps source order between nodes whose delays are equal', () => {
    const delays = new Map([
      ['🇹🇼 台湾 01', 50],
      ['🇹🇼 台湾 02', 50],
      ['🇹🇼 台湾 03', 20]
    ])
    const ordered = orderProxiesByRegionPriority([...NODES], ['台湾'], { delayMs: delays })
    assert.deepEqual(
      ordered.slice(0, 3).map((proxy) => proxy.name),
      ['🇹🇼 台湾 03', '🇹🇼 台湾 01', '🇹🇼 台湾 02']
    )
  })

  it('keeps source order inside a segment when no node has delay data', () => {
    const ordered = orderProxiesByRegionPriority([...NODES], ['日本'], { delayMs: new Map() })
    assert.deepEqual(
      ordered.slice(0, 2).map((proxy) => proxy.name),
      ['🇯🇵 日本 01', '🇯🇵 日本 02']
    )
  })

  it('excludes nodes confirmed as Gemini region-blocked while falling back if all are blocked', () => {
    const blocked = new Set(['🇯🇵 日本 02', '🇹🇼 台湾 02'])
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [...NODES],
      regionPriority: ['日本', '台湾'],
      blockedNodeNames: blocked
    })
    assert.deepEqual(
      proxies.map((proxy) => proxy.name),
      ['🇯🇵 日本 01', '🇯🇵 日本 03', '🇹🇼 台湾 01', '🇹🇼 台湾 03', 'KR-VPS-Reality']
    )

    const allBlocked = new Set([
      '🇯🇵 日本 01',
      '🇯🇵 日本 02',
      '🇯🇵 日本 03',
      '🇹🇼 台湾 01',
      '🇹🇼 台湾 02',
      '🇹🇼 台湾 03',
      'KR-VPS-Reality'
    ])
    const fallback = orderProxiesByRegionPriority([...NODES], ['日本', '台湾'], {
      blockedNodeNames: allBlocked
    })
    assert.equal(fallback.length, 7)
  })

  describe('sunk nodes', () => {
    const names = (proxies: Array<{ name?: unknown }>): string[] =>
      proxies.map((proxy) => String(proxy.name))

    it('moves them to the very end, keeping the order of everything else and of the sunk ones', () => {
      const ordered = orderProxiesByRegionPriority([...NODES], ['日本', '台湾'], {
        sunkNodeNames: new Set(['🇯🇵 日本 01', '🇹🇼 台湾 02'])
      })

      assert.deepEqual(names(ordered), [
        '🇯🇵 日本 02',
        '🇯🇵 日本 03',
        '🇹🇼 台湾 01',
        '🇹🇼 台湾 03',
        'KR-VPS-Reality',
        '🇯🇵 日本 01',
        '🇹🇼 台湾 02'
      ])
    })

    it('sinks after latency ordering, even below the nodes that have no delay sample', () => {
      const ordered = orderProxiesByRegionPriority([...NODES], ['台湾', '日本'], {
        delayMs: new Map([
          ['🇯🇵 日本 03', 90],
          ['🇯🇵 日本 02', 40],
          ['🇹🇼 台湾 03', 30]
        ]),
        sunkNodeNames: new Set(['🇹🇼 台湾 03'])
      })

      assert.deepEqual(names(ordered), [
        '🇯🇵 日本 02',
        '🇯🇵 日本 03',
        '🇹🇼 台湾 01',
        '🇹🇼 台湾 02',
        '🇯🇵 日本 01',
        'KR-VPS-Reality',
        '🇹🇼 台湾 03'
      ])
    })

    it('keeps every node, in the usual order, when all of them are sunk', () => {
      const usual = names(orderProxiesByRegionPriority([...NODES], ['日本', '台湾']))

      const ordered = orderProxiesByRegionPriority([...NODES], ['日本', '台湾'], {
        sunkNodeNames: new Set(usual)
      })

      assert.deepEqual(names(ordered), usual)
    })

    it('does not resurrect a blocked node, and sinks the others as usual', () => {
      const ordered = orderProxiesByRegionPriority([...NODES], ['日本', '台湾'], {
        blockedNodeNames: new Set(['🇯🇵 日本 02']),
        sunkNodeNames: new Set(['🇯🇵 日本 02', '🇹🇼 台湾 01'])
      })

      assert.deepEqual(names(ordered), [
        '🇯🇵 日本 01',
        '🇯🇵 日本 03',
        '🇹🇼 台湾 02',
        '🇹🇼 台湾 03',
        'KR-VPS-Reality',
        '🇹🇼 台湾 01'
      ])
    })

    it('ignores sunk names that are not in the subscription', () => {
      const usual = orderProxiesByRegionPriority([...NODES], ['日本', '台湾'])

      const ordered = orderProxiesByRegionPriority([...NODES], ['日本', '台湾'], {
        sunkNodeNames: new Set(['no-such-node'])
      })

      assert.deepEqual(names(ordered), names(usual))
    })

    it('is honoured when building the provider document', () => {
      const { proxies } = buildSparkleFastProviderDocument({
        proxies: [...NODES],
        regionPriority: ['日本'],
        sunkNodeNames: new Set(['🇯🇵 日本 01'])
      })

      assert.equal(names(proxies)[0], '🇯🇵 日本 02')
      assert.equal(names(proxies).at(-1), '🇯🇵 日本 01')
    })
  })
})
