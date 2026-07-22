import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_DELAY_TEST_URL } from './cursorProxyGroup'
import { buildBaseConfigWithProviders } from './providerConfigCore'
import {
  VPS_PROVIDER_HEALTH_CHECK_INTERVAL_SEC,
  resolveVpsProviderId
} from './vpsProviderSplitCore'

describe('provider VPS split integration', () => {
  it('emits dual providers with commercial generate_204 and VPS api2 lazy 600s', () => {
    const profileId = '199e64b94e8'
    const profile = {
      proxies: [
        { name: 'SG-01', type: 'trojan' },
        { name: 'KR-VPS-HY2', type: 'hysteria2' },
        { name: 'JP-VPS-Reality', type: 'vless' }
      ],
      'proxy-groups': [
        {
          name: '🎯 Cursor 专用',
          type: 'select',
          use: [profileId],
          filter: '(?i)vps'
        }
      ]
    } as unknown as MihomoConfig

    const base = buildBaseConfigWithProviders(
      profile,
      profileId,
      (providerId) => `${providerId}-proxies.yaml`,
      {
        enable: true,
        interval: 300,
        url: 'http://example.com/custom-commercial-only'
      }
    )

    const providers = base['proxy-providers'] as Record<
      string,
      {
        path: string
        'health-check': { url: string; interval: number; lazy?: boolean }
      }
    >

    const vpsProviderId = resolveVpsProviderId(profileId)
    assert.ok(providers[profileId])
    assert.ok(providers[vpsProviderId])
    assert.equal(
      providers[profileId]['health-check'].url,
      'http://example.com/custom-commercial-only'
    )
    assert.equal(providers[profileId]['health-check'].interval, 300)
    assert.equal(providers[vpsProviderId]['health-check'].url, CURSOR_DELAY_TEST_URL)
    assert.equal(
      providers[vpsProviderId]['health-check'].interval,
      VPS_PROVIDER_HEALTH_CHECK_INTERVAL_SEC
    )
    assert.equal(providers[vpsProviderId]['health-check'].lazy, true)

    const cursorGroup = (base['proxy-groups'] as { name: string; use?: string[]; filter?: string }[]).find(
      (group) => group.name === '🎯 Cursor 专用'
    )
    assert.deepEqual(cursorGroup?.use, [vpsProviderId])
    assert.equal(cursorGroup?.filter, undefined)
  })

  it('keeps single commercial provider when no VPS leaves exist', () => {
    const profileId = 'abc123'
    const profile = {
      proxies: [{ name: 'SG-01', type: 'trojan' }],
      'proxy-groups': [{ name: '自动选择', type: 'url-test', proxies: ['SG-01'] }]
    } as unknown as MihomoConfig

    const base = buildBaseConfigWithProviders(profile, profileId, (providerId) => `${providerId}-proxies.yaml`)
    const providers = base['proxy-providers'] as Record<string, unknown>

    assert.ok(providers[profileId])
    assert.equal(providers[resolveVpsProviderId(profileId)], undefined)
  })
})
