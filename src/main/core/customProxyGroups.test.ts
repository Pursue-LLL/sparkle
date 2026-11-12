import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGY_DEDICATED_GROUP_NAME,
  CURSOR_DEDICATED_DIRECT_PROXY,
  CURSOR_DEDICATED_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME,
  prependCursorDedicatedDirectOption
} from './cursorProxyGroup'
import { HONG_KONG_FILTER_GROUP_NAME, ensureCustomProxyGroups } from './customProxyGroups'
import { groupNames, groupProxies, profileOf } from './customProxyGroupsRig'
import { GROK_NODE_PROVIDER_ID } from './sparkleGrokProviderCore'
import { MAIL_PROBE_LISTENER_PORT } from './sparkleMailProviderCore'

describe('customProxyGroups', () => {
  it('prependCursorDedicatedDirectOption dedupes and keeps DIRECT first', () => {
    assert.deepEqual(prependCursorDedicatedDirectOption(['KR-VPS-HY2']), [
      CURSOR_DEDICATED_DIRECT_PROXY,
      'KR-VPS-HY2'
    ])
    assert.deepEqual(prependCursorDedicatedDirectOption(['DIRECT', 'KR-VPS-HY2']), [
      CURSOR_DEDICATED_DIRECT_PROXY,
      'KR-VPS-HY2'
    ])
    assert.deepEqual(prependCursorDedicatedDirectOption(['KR-VPS-HY2', 'DIRECT', 'KR-VPS-HY2']), [
      CURSOR_DEDICATED_DIRECT_PROXY,
      'KR-VPS-HY2',
      'KR-VPS-HY2'
    ])
  })

  it('builds a provider-backed Cursor group with DIRECT and the VPS provider', () => {
    const profile = {
      'proxy-groups': [
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01', 'KR-VPS-HY2', 'TW-01'] },
        { name: '自动选择', type: 'url-test', proxies: ['SG-01', 'TW-01'] }
      ]
    } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['SG-01', 'KR-VPS-HY2', 'TW-01', 'HK-01'], 'test-profile')

    assert.deepEqual(groupProxies(profile, CURSOR_DEDICATED_GROUP_NAME), [
      CURSOR_DEDICATED_DIRECT_PROXY
    ])
    const cursorGroup = (
      (profile['proxy-groups'] as {
        name: string
        use?: string[]
        filter?: string
        proxies?: string[]
      }[]) ?? []
    ).find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
    assert.deepEqual(cursorGroup?.use, ['test-profile-vps'])
    assert.deepEqual(cursorGroup?.proxies, [CURSOR_DEDICATED_DIRECT_PROXY])
    // 与 cursorProxyGroup 的 CURSOR_VPS_PROVIDER_FILTER 对齐（Reality 优先，HY2 次选）。
    assert.equal(cursorGroup?.filter, '(?i)-VPS-(Reality|HY2)$')
    assert.ok(groupNames(profile).includes(HONG_KONG_FILTER_GROUP_NAME))
    assert.ok(groupNames(profile).includes('🚀 节点选择'))
    assert.equal(groupNames(profile)[0], CURSOR_DEDICATED_GROUP_NAME)
  })

  it('keeps Cursor group without VPS provider when there are no VPS nodes', () => {
    const profile = { 'proxy-groups': [] } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['SG-01', 'JP-02'], 'test-profile')

    const cursorGroup = (
      (profile['proxy-groups'] as { name: string; use?: string[]; filter?: string }[]) ?? []
    ).find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
    assert.ok(cursorGroup)
    assert.equal(cursorGroup.use, undefined)
    assert.equal(cursorGroup.filter, undefined)
    assert.deepEqual(groupProxies(profile, CURSOR_DEDICATED_GROUP_NAME), [
      CURSOR_DEDICATED_DIRECT_PROXY
    ])
    assert.ok(groupNames(profile).includes(HONG_KONG_FILTER_GROUP_NAME))
  })

  it('refreshes Sparkle groups and drops stale subscription copies', () => {
    const profile = {
      'proxy-groups': [
        {
          name: CURSOR_DEDICATED_GROUP_NAME,
          type: 'select',
          proxies: ['stale-node']
        },
        {
          name: HONG_KONG_FILTER_GROUP_NAME,
          type: 'select',
          proxies: ['stale-hk']
        },
        { name: '套餐组', type: 'select', proxies: ['SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['MY-VPS-01', '香港-A', 'SG-01'], 'test-profile')

    assert.deepEqual(groupProxies(profile, CURSOR_DEDICATED_GROUP_NAME), [
      CURSOR_DEDICATED_DIRECT_PROXY
    ])
    const hkGroup = ((profile['proxy-groups'] as { name: string; filter?: string }[]) ?? []).find(
      (group) => group.name === HONG_KONG_FILTER_GROUP_NAME
    )
    assert.equal(hkGroup?.filter, '香港|(?i)\\bHK\\b|hong\\s*kong|hongkong')
    assert.equal(
      groupNames(profile).filter((name) => name === CURSOR_DEDICATED_GROUP_NAME).length,
      1
    )
  })

  it('builds Grok group as select over the verified provider (app probe picks one)', () => {
    const profile = { 'proxy-groups': [] } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['HK-01', 'SG-01'], 'test-profile')

    const grokGroup = (
      (profile['proxy-groups'] as {
        name: string
        type?: string
        use?: string[]
        filter?: string
      }[]) ?? []
    ).find((group) => group.name === GROK_DEDICATED_GROUP_NAME)

    assert.equal(grokGroup?.type, 'select')
    assert.deepEqual(grokGroup?.use, [GROK_NODE_PROVIDER_ID])
    // 不限地区：任何真正返回 200 的节点都可以被探针选中。
    assert.equal(grokGroup?.filter, undefined)
  })

  it('builds Grok group from every leaf in inline mode', () => {
    const profile = { 'proxy-groups': [] } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['HK-01', 'JP-01', 'HK-01', 'US-01'])

    const grokGroup = (
      (profile['proxy-groups'] as {
        name: string
        type?: string
        proxies?: string[]
      }[]) ?? []
    ).find((group) => group.name === GROK_DEDICATED_GROUP_NAME)

    assert.equal(grokGroup?.type, 'select')
    assert.deepEqual(grokGroup?.proxies, ['HK-01', 'JP-01', 'US-01'])
  })

  it('keeps Grok group even when there is no Hong Kong node', () => {
    const profile = { 'proxy-groups': [] } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['JP-01', 'US-01'])

    assert.ok(!groupNames(profile).includes(HONG_KONG_FILTER_GROUP_NAME))
    assert.ok(groupNames(profile).includes(GROK_DEDICATED_GROUP_NAME))
  })

  it('leaves subscription groups out of the inline Cursor group', () => {
    const profile = {
      'proxy-groups': [
        { name: '手动', type: 'select', proxies: ['SG-01'] },
        { name: '自动选择', type: 'url-test', proxies: ['SG-01', 'TW-01'] },
        { name: '故障转移', type: 'fallback', proxies: ['SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['MY-VPS-01', 'SG-01'])

    assert.deepEqual(groupProxies(profile, CURSOR_DEDICATED_GROUP_NAME), [
      CURSOR_DEDICATED_DIRECT_PROXY,
      'MY-VPS-01'
    ])
  })

  it('rewrites broad GEOIP/google rules away from Cursor 专用', () => {
    const profile = {
      'proxy-groups': [{ name: '默认', type: 'select', proxies: [] }],
      rules: [
        `GEOIP,us,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-KEYWORD,google,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-KEYWORD,chatgpt,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-SUFFIX,.ai,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN,api2.cursor.sh,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-KEYWORD,cursor,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`
      ]
    } as unknown as MihomoConfig

    const migrated = ensureCustomProxyGroups(profile, ['KR-VPS-Reality'], 'test-profile')

    assert.equal(migrated, true)
    assert.deepEqual(profile.rules, [
      'GEOIP,us,自动选择',
      'DOMAIN-KEYWORD,google,自动选择',
      'DOMAIN-KEYWORD,chatgpt,自动选择',
      'DOMAIN-SUFFIX,.ai,自动选择',
      `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN-KEYWORD,cursor,${CURSOR_DEDICATED_GROUP_NAME}`
    ])
  })

  it('puts the Sparkle groups ahead of the subscription groups in a fixed order', () => {
    const profile = profileOf([{ name: '套餐', type: 'select', proxies: ['SG-01'] }])

    ensureCustomProxyGroups(profile, ['MY-VPS-HY2', '香港-A', 'SG-01'], 'test-profile')

    assert.deepEqual(groupNames(profile), [
      CURSOR_DEDICATED_GROUP_NAME,
      HONG_KONG_FILTER_GROUP_NAME,
      GROK_DEDICATED_GROUP_NAME,
      MAIL_DEDICATED_GROUP_NAME,
      MAIL_PROBE_HIDDEN_GROUP_NAME,
      AGY_DEDICATED_GROUP_NAME,
      '套餐'
    ])
    const listeners = profile.listeners as { port: number; proxy: string }[]
    assert.deepEqual(
      listeners.map(({ port, proxy }) => ({ port, proxy })),
      [{ port: MAIL_PROBE_LISTENER_PORT, proxy: MAIL_PROBE_HIDDEN_GROUP_NAME }]
    )
  })

  it('builds the inline Cursor group from eligible VPS leaves only, sorted', () => {
    const profile = profileOf([])

    ensureCustomProxyGroups(profile, [
      'B-VPS-HY2',
      'A-VPS-Reality',
      'A-VPS-Reality',
      'KR-VPS-TLS',
      'SG-01'
    ])

    assert.deepEqual(groupProxies(profile, CURSOR_DEDICATED_GROUP_NAME), [
      CURSOR_DEDICATED_DIRECT_PROXY,
      'A-VPS-Reality',
      'B-VPS-HY2'
    ])
    assert.equal(profile.listeners, undefined)
  })

  it('creates only the Cursor group while there is no node to build the others from', () => {
    const profile = profileOf([{ name: '套餐', type: 'select', proxies: [] }])

    const migrated = ensureCustomProxyGroups(profile, [])

    assert.equal(migrated, false)
    assert.deepEqual(groupNames(profile), [CURSOR_DEDICATED_GROUP_NAME, '套餐'])
  })
})
