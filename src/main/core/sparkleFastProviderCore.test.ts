import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSparkleFastProviderDocument,
  listFlatAutoSelectProxyNames,
  orderProxiesByRegionPriority,
} from './sparkleFastProviderCore'

const NODES = [
  { name: '🇹🇼 台湾 01', type: 'anytls' },
  { name: '🇹🇼 台湾 02', type: 'hysteria2' },
  { name: '🇹🇼 台湾 03', type: 'trojan' },
  { name: '🇯🇵 日本 01', type: 'anytls' },
  { name: '🇯🇵 日本 02', type: 'trojan' },
  { name: 'KR-VPS-Reality', type: 'vless' },
]

describe('sparkleFastProviderCore', () => {
  it('orders eligible nodes by region priority (JP before TW when configured)', () => {
    const ordered = orderProxiesByRegionPriority([...NODES], ['日本', '台湾'])
    assert.deepEqual(
      ordered.map((proxy) => proxy.name),
      ['🇯🇵 日本 01', '🇯🇵 日本 02', '🇹🇼 台湾 01', '🇹🇼 台湾 02', '🇹🇼 台湾 03', 'KR-VPS-Reality'],
    )
  })

  it('drops hy2 and anytls from the flat auto-select provider document', () => {
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [...NODES],
      regionPriority: ['日本', '台湾'],
    })
    assert.deepEqual(
      proxies.map((proxy) => proxy.name),
      ['🇯🇵 日本 02', '🇹🇼 台湾 03', 'KR-VPS-Reality'],
    )
    assert.deepEqual(listFlatAutoSelectProxyNames([...NODES], ['日本', '台湾']), [
      '🇯🇵 日本 02',
      '🇹🇼 台湾 03',
      'KR-VPS-Reality',
    ])
  })

  it('treats excluded proxy types case-insensitively', () => {
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [
        { name: 'A', type: 'AnyTLS' },
        { name: 'B', type: ' Hysteria2 ' },
        { name: 'C', type: 'trojan' },
      ],
      regionPriority: ['台湾'],
    })
    assert.deepEqual(
      proxies.map((proxy) => proxy.name),
      ['C'],
    )
  })

  it('yields an empty member list when every node is excluded', () => {
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [{ name: 'A', type: 'anytls' }],
      regionPriority: ['台湾'],
    })
    assert.deepEqual(proxies, [])
  })
})
