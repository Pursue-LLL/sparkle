import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  AGY_NODE_PROVIDER_ID,
  buildAgyGroupConfig,
  buildSparkleAgyProviderDocument,
  classifyAgyProbeResponse,
  orderAgyProxies,
  type AgyNodeProbeRecord,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'

const NODES: AgyProxyRecord[] = [
  { name: '新加坡-优化2-GPT', type: 'vmess', server: 'sg.a.example', port: 16618 },
  { name: '美国LA-优化2-GPT', type: 'vmess', server: 'us.a.example', port: 16648 },
  { name: '美国LA-优化3-GPT', type: 'vmess', server: 'us.b.example', port: 16648 },
  { name: '🇯🇵 日本 02', type: 'vless', server: 'jp.example', port: 443 },
  { name: '🇭🇰 香港 01', type: 'vmess', server: 'hk.example', port: 443 },
  { name: '🇹🇼 台湾 01', type: 'anytls', server: 'tw.tls.example', port: 27005 }
]

const REGION_PRIORITY = ['台湾', '日本', '韩国', '新加坡', '美国']

function record(usable: boolean, rttMs: number): AgyNodeProbeRecord {
  return { usable, rttMs, checkedAt: 1000 }
}

function names(proxies: readonly AgyProxyRecord[]): string[] {
  return proxies.map((proxy) => String(proxy.name))
}

describe('classifyAgyProbeResponse', () => {
  it('treats HTTP 200 as a usable node', () => {
    assert.equal(classifyAgyProbeResponse(200, '{"choices":[]}'), 'usable')
  })

  it('treats the location violation as unusable', () => {
    const body =
      '{"error":{"message":"Antigravity: User location is not supported for the API use."}}'
    assert.equal(classifyAgyProbeResponse(400, body), 'unusable')
  })

  it('keeps other 400s and rate limits undecided', () => {
    assert.equal(classifyAgyProbeResponse(400, '{"error":{"message":"bad request"}}'), 'unknown')
    assert.equal(classifyAgyProbeResponse(429, '{"error":{"message":"quota"}}'), 'unknown')
    assert.equal(classifyAgyProbeResponse(500, 'oops'), 'unknown')
  })

  it('flags 404/405 as fatal (magpie model/route mismatch)', () => {
    assert.equal(classifyAgyProbeResponse(404, 'not found'), 'fatal')
    assert.equal(classifyAgyProbeResponse(405, 'method not allowed'), 'fatal')
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

  it('cold start keeps every non-HK, non-AnyTLS candidate (provider must never be empty)', () => {
    assert.deepEqual(names(orderAgyProxies(NODES, REGION_PRIORITY)), [
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

  it('falls back to the whole pool when every node is confirmed unusable', () => {
    const cache = new Map<string, AgyNodeProbeRecord>(
      NODES.map((node) => [computeProxyNodeFingerprint(node), record(false, 100)])
    )

    const result = names(orderAgyProxies(NODES, REGION_PRIORITY, cache))
    assert.equal(result.length, 4)
    assert.ok(!result.includes('🇭🇰 香港 01'))
    assert.ok(!result.includes('🇹🇼 台湾 01'))
  })
})

describe('buildSparkleAgyProviderDocument', () => {
  it('wraps the ordered node list in a provider document', () => {
    const document = buildSparkleAgyProviderDocument({
      proxies: NODES,
      regionPriority: REGION_PRIORITY
    })
    assert.equal(document.proxies.length, 4)
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
    const group = buildAgyGroupConfig(
      ['🇯🇵 日本 02', '🇭🇰 香港 01', '  '],
      undefined
    )
    assert.deepEqual(group, {
      name: AGY_DEDICATED_GROUP_NAME,
      type: 'select',
      proxies: ['🇯🇵 日本 02']
    })
  })

  it('returns null when no eligible leaf exists', () => {
    assert.equal(buildAgyGroupConfig(['🇭🇰 香港 01'], undefined), null)
  })
})
