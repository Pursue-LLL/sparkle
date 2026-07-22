import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCommercialProviderHealthCheck,
  buildVpsProviderHealthCheck,
  isVpsLeafProxy,
  isVpsProviderId,
  partitionLeafProxies,
  resolveVpsProviderId,
  rewriteVpsFilteredGroupsToDedicatedProvider
} from './vpsProviderSplitCore'
import { CURSOR_DELAY_TEST_URL } from './cursorProxyGroup'

describe('vpsProviderSplitCore', () => {
  it('resolves vps provider id suffix', () => {
    assert.equal(resolveVpsProviderId('199e64b94e8'), '199e64b94e8-vps')
    assert.equal(isVpsProviderId('199e64b94e8-vps'), true)
    assert.equal(isVpsProviderId('199e64b94e8'), false)
  })

  it('partitions VPS leaf nodes from commercial nodes', () => {
    const proxies = [
      { name: 'SG-01', type: 'trojan' },
      { name: 'KR-VPS-HY2', type: 'hysteria2' },
      { name: 'JP-VPS-Reality', type: 'vless' }
    ]
    const { commercial, vps } = partitionLeafProxies(proxies)
    assert.deepEqual(
      commercial.map((item) => (item as { name: string }).name),
      ['SG-01']
    )
    assert.deepEqual(
      vps.map((item) => (item as { name: string }).name),
      ['KR-VPS-HY2', 'JP-VPS-Reality']
    )
  })

  it('detects VPS leaf by name case-insensitively', () => {
    assert.equal(isVpsLeafProxy({ name: 'my-vps-node', type: 'trojan' }), true)
    assert.equal(isVpsLeafProxy({ name: 'SG-01', type: 'trojan' }), false)
  })

  it('uses generate_204 for commercial-only provider health-check', () => {
    const healthCheck = buildCommercialProviderHealthCheck([{ name: 'SG-01', type: 'trojan' }])
    assert.equal(healthCheck.url, 'http://www.gstatic.com/generate_204')
  })

  it('uses api2 lazy health-check for vps provider', () => {
    const healthCheck = buildVpsProviderHealthCheck()
    assert.equal(healthCheck.url, CURSOR_DELAY_TEST_URL)
    assert.equal(healthCheck.interval, 600)
    assert.equal(healthCheck.lazy, true)
  })

  it('rewrites vps-filtered groups to dedicated vps provider', () => {
    const profile = {
      'proxy-groups': [
        {
          name: '🎯 Cursor-专用',
          type: 'select',
          use: ['199e64b94e8'],
          filter: '(?i)vps'
        },
        {
          name: '🇭🇰 香港节点',
          type: 'url-test',
          use: ['199e64b94e8'],
          filter: '香港'
        }
      ]
    } as unknown as MihomoConfig

    const rewritten = rewriteVpsFilteredGroupsToDedicatedProvider(profile, '199e64b94e8', 6)
    assert.equal(rewritten, true)
    const cursorGroup = (profile['proxy-groups'] as { name: string; use?: string[]; filter?: string }[])[0]
    assert.deepEqual(cursorGroup.use, ['199e64b94e8-vps'])
    assert.equal(cursorGroup.filter, undefined)
    const hkGroup = (profile['proxy-groups'] as { name: string; filter?: string }[])[1]
    assert.equal(hkGroup.filter, '香港')
  })

  it('returns false when rewrite is not needed', () => {
    const profile = {
      'proxy-groups': [{ name: '自动选择', type: 'url-test', use: ['199e64b94e8'], filter: '日本' }]
    } as unknown as MihomoConfig
    assert.equal(rewriteVpsFilteredGroupsToDedicatedProvider(profile, '199e64b94e8', 6), false)
    assert.equal(rewriteVpsFilteredGroupsToDedicatedProvider(profile, '199e64b94e8', 0), false)
  })

  it('partitions empty and vps-only profiles safely', () => {
    assert.deepEqual(partitionLeafProxies([]), { commercial: [], vps: [] })
    const onlyVps = [{ name: 'KR-VPS-HY2', type: 'hysteria2' }]
    const part = partitionLeafProxies(onlyVps)
    assert.equal(part.commercial.length, 0)
    assert.equal(part.vps.length, 1)
  })

  it('does not mark commercial provider api2 when VPS already split out', () => {
    const commercialOnly = Array.from({ length: 5 }, (_, index) => ({
      name: `SG-${index}`,
      type: 'trojan'
    }))
    const healthCheck = buildCommercialProviderHealthCheck(commercialOnly)
    assert.equal(healthCheck.url, 'http://www.gstatic.com/generate_204')
  })
})
