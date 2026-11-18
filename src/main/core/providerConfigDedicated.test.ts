import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ALL_GROUPS_OFF, ALL_GROUPS_ON } from './dedicatedGroupsRig'
import type { DedicatedGroupId } from './dedicatedGroups'
import { buildBaseConfigWithProviders } from './providerConfigCore'
import { AGY_NODE_PROVIDER_ID } from './sparkleAgyProviderCore'
import { FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import { GEMINI_NODE_PROVIDER_ID } from './sparkleGeminiProviderCore'
import { GROK_NODE_PROVIDER_ID } from './sparkleGrokProviderCore'
import { MAIL_NODE_PROVIDER_ID } from './sparkleMailProviderCore'

const PROFILE_ID = 'profile-1'
const PROVIDER_BY_GROUP: Record<DedicatedGroupId, string> = {
  grok: GROK_NODE_PROVIDER_ID,
  gemini: GEMINI_NODE_PROVIDER_ID,
  mail: MAIL_NODE_PROVIDER_ID,
  agy: AGY_NODE_PROVIDER_ID
}

function providersOf(switches: DedicatedGroupSwitches): Record<string, unknown> {
  const profile = {
    proxies: [{ name: 'SG-01', type: 'trojan' }],
    'proxy-groups': [{ name: '自动选择', type: 'url-test', proxies: ['SG-01'] }]
  } as unknown as MihomoConfig
  const base = buildBaseConfigWithProviders(
    profile,
    PROFILE_ID,
    (providerId) => `${providerId}-proxies.yaml`,
    switches
  )
  return base['proxy-providers'] as Record<string, unknown>
}

describe('buildBaseConfigWithProviders · 专用组开关', () => {
  it('registers every dedicated provider while all switches are on', () => {
    const providers = providersOf(ALL_GROUPS_ON)

    for (const providerId of Object.values(PROVIDER_BY_GROUP)) {
      assert.ok(providers[providerId], providerId)
    }
  })

  for (const id of Object.keys(PROVIDER_BY_GROUP) as DedicatedGroupId[]) {
    it(`leaves out only the ${id} provider while its switch is off`, () => {
      const providers = providersOf({ ...ALL_GROUPS_ON, [id]: false })

      assert.equal(providers[PROVIDER_BY_GROUP[id]], undefined)
      for (const other of Object.keys(PROVIDER_BY_GROUP) as DedicatedGroupId[]) {
        assert.equal(Boolean(providers[PROVIDER_BY_GROUP[other]]), other !== id, other)
      }
    })
  }

  it('always keeps the subscription and fast providers, even with every switch off', () => {
    const providers = providersOf(ALL_GROUPS_OFF)

    assert.deepEqual(Object.keys(providers).sort(), [FAST_NODE_PROVIDER_ID, PROFILE_ID].sort())
  })

  it('does not let the grok provider run periodic health checks', () => {
    const providers = providersOf(ALL_GROUPS_ON) as Record<
      string,
      { 'health-check': { enable: boolean } }
    >

    assert.equal(providers[GROK_NODE_PROVIDER_ID]['health-check'].enable, false)
  })
})
