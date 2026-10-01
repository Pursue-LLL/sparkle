import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSparkleFastProviderDocument,
  orderProxiesByRegionPriority,
} from './sparkleFastProviderCore'

const NODES = [
  { name: '🇹🇼 台湾 01', type: 'anytls' },
  { name: '🇹🇼 台湾 02', type: 'hysteria2' },
  { name: '🇯🇵 日本 01', type: 'anytls' },
  { name: '🇯🇵 日本 02', type: 'hysteria2' },
  { name: 'KR-VPS-Reality', type: 'vless' },
]

describe('sparkleFastProviderCore', () => {
  it('keeps every non-anytls node when ordering', () => {
    const ordered = orderProxiesByRegionPriority([...NODES], ['台湾', '日本'])
    assert.deepEqual(
      ordered.map((proxy) => proxy.name),
      ['🇹🇼 台湾 01', '🇹🇼 台湾 02', '🇯🇵 日本 01', '🇯🇵 日本 02', 'KR-VPS-Reality'],
    )
  })

  it('drops anytls leaves from the provider document', () => {
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [...NODES],
      regionPriority: ['台湾', '日本'],
    })
    assert.deepEqual(
      proxies.map((proxy) => proxy.name),
      ['🇹🇼 台湾 02', '🇯🇵 日本 02', 'KR-VPS-Reality'],
    )
  })

  it('treats the anytls type case-insensitively', () => {
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [
        { name: 'A', type: 'AnyTLS' },
        { name: 'B', type: ' anytls ' },
        { name: 'C', type: 'hysteria2' },
      ],
      regionPriority: ['台湾'],
    })
    assert.deepEqual(
      proxies.map((proxy) => proxy.name),
      ['C'],
    )
  })

  it('yields an empty member list when every node is anytls', () => {
    const { proxies } = buildSparkleFastProviderDocument({
      proxies: [{ name: 'A', type: 'anytls' }],
      regionPriority: ['台湾'],
    })
    assert.deepEqual(proxies, [])
  })
})