import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSparkleMailProviderDocument,
  mailProviderMembershipChanged,
  orderMailProxies,
  type MailNodeProbeRecord,
} from './sparkleMailProviderCore'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'

const SAMPLE_NODES = [
  { name: '🇹🇼 台湾 01', type: 'anytls', server: 'tw.tls.yytls.top', port: 27005 },
  { name: '🇨🇳 台湾 V1', type: 'trojan', server: '58.254.184.130', port: 44150 },
  { name: '🇹🇼 台湾 02', type: 'hysteria2', server: 'v6o0sl.quic.yydzx.xyz', ports: '15001-16000' },
  { name: '🇯🇵 日本 02', type: 'hysteria2', server: 'el5wny.quic.yydzx.xyz', ports: '14001-15000' },
  { name: '🇭🇰 香港 02', type: 'hysteria2', server: 'qzknli.quic.yydzx.xyz', ports: '12001-13000' },
]

describe('sparkleMailProviderCore', () => {
  it('computes deterministic node fingerprints', () => {
    assert.equal(
      computeProxyNodeFingerprint(SAMPLE_NODES[2]),
      '🇹🇼 台湾 02|hysteria2|v6o0sl.quic.yydzx.xyz|15001-16000',
    )
  })

  it('strictly keeps only verified alive=true nodes when probeCache has alive entries', () => {
    const cache = new Map<string, MailNodeProbeRecord>([
      [computeProxyNodeFingerprint(SAMPLE_NODES[1]), { alive: false, rttMs: 0, checkedAt: 1000 }],
      [computeProxyNodeFingerprint(SAMPLE_NODES[2]), { alive: true, rttMs: 420, checkedAt: 1000 }],
      [computeProxyNodeFingerprint(SAMPLE_NODES[3]), { alive: true, rttMs: 310, checkedAt: 1000 }],
      [computeProxyNodeFingerprint(SAMPLE_NODES[4]), { alive: true, rttMs: 180, checkedAt: 1000 }],
    ])

    const { proxies } = buildSparkleMailProviderDocument({
      proxies: [...SAMPLE_NODES],
      regionPriority: ['台湾', '日本'],
      probeCache: cache,
    })

    // 仅保留 alive=true，按地区序（台湾 -> 日本 -> 香港兜底），剔除封端口的 台湾 V1 和未验证的 台湾 01
    assert.deepEqual(
      proxies.map((proxy) => proxy.name),
      ['🇹🇼 台湾 02', '🇯🇵 日本 02', '🇭🇰 香港 02'],
    )
  })

  it('orders preferred Hysteria2/VLESS candidates ahead of other protocols on cold start before probe', () => {
    const ordered = orderMailProxies([...SAMPLE_NODES], ['台湾', '日本'])
    // 在同一地区（台湾）内，hysteria2 排在前面，AnyTLS 与 Trojan 按订阅原序跟随
    assert.deepEqual(
      ordered.map((proxy) => proxy.name),
      ['🇹🇼 台湾 02', '🇹🇼 台湾 01', '🇨🇳 台湾 V1', '🇯🇵 日本 02', '🇭🇰 香港 02'],
    )
  })

  it('never returns an empty list even when all cached entries are dead, AnyTLS nodes included', () => {
    const cache = new Map<string, MailNodeProbeRecord>(
      SAMPLE_NODES.map((node) => [
        computeProxyNodeFingerprint(node),
        { alive: false, rttMs: 0, checkedAt: 1000 },
      ]),
    )
    const { proxies } = buildSparkleMailProviderDocument({
      proxies: [...SAMPLE_NODES],
      regionPriority: ['台湾', '日本'],
      probeCache: cache,
    })
    assert.equal(proxies.length > 0, true)
    assert.equal(
      proxies.some((proxy) => proxy.type === 'anytls'),
      true,
    )
  })

  it('detects membership changes but ignores pure order changes', () => {
    assert.equal(mailProviderMembershipChanged(['A', 'B'], ['B', 'A']), false)
    assert.equal(mailProviderMembershipChanged(['A', 'B'], ['A', 'B']), false)
    assert.equal(mailProviderMembershipChanged(['A', 'B'], ['A']), true)
    assert.equal(mailProviderMembershipChanged(['A'], ['A', 'B']), true)
    assert.equal(mailProviderMembershipChanged([], ['A']), true)
    assert.equal(mailProviderMembershipChanged([], []), false)
  })
})
