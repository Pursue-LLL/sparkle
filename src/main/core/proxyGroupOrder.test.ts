import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGY_DEDICATED_GROUP_NAME,
  AUTO_SELECT_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  GEMINI_DEDICATED_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME
} from './cursorProxyGroup'
import { orderProxyGroups } from './proxyGroupOrder'

function group(name: string): { name: string; type: string } {
  return { name, type: 'select' }
}

function namesOf(profile: MihomoConfig): string[] {
  return ((profile['proxy-groups'] as { name?: string }[]) ?? []).map((item) => String(item.name))
}

describe('proxyGroupOrder', () => {
  it('orders auto-select → dedicated → region → the rest', () => {
    const profile = {
      'proxy-groups': [
        group('🚀 节点选择'),
        group('Sparkle-台湾'),
        group(AGY_DEDICATED_GROUP_NAME),
        group('🐟 漏网之鱼'),
        group(AUTO_SELECT_GROUP_NAME),
        group(CURSOR_DEDICATED_GROUP_NAME),
        group(GROK_DEDICATED_GROUP_NAME),
        group('Sparkle-香港'),
        group(MAIL_DEDICATED_GROUP_NAME),
        group(GEMINI_DEDICATED_GROUP_NAME)
      ]
    } as unknown as MihomoConfig

    orderProxyGroups(profile)

    assert.deepEqual(namesOf(profile), [
      AUTO_SELECT_GROUP_NAME,
      CURSOR_DEDICATED_GROUP_NAME,
      GROK_DEDICATED_GROUP_NAME,
      GEMINI_DEDICATED_GROUP_NAME,
      MAIL_DEDICATED_GROUP_NAME,
      AGY_DEDICATED_GROUP_NAME,
      'Sparkle-台湾',
      'Sparkle-香港',
      '🚀 节点选择',
      '🐟 漏网之鱼'
    ])
  })

  it('keeps the relative order inside every tier', () => {
    const profile = {
      'proxy-groups': [
        group('🔍 Google'),
        group('⌨️ GitHub'),
        group('Sparkle-美国'),
        group('Sparkle-日本'),
        group(MAIL_PROBE_HIDDEN_GROUP_NAME),
        group(MAIL_DEDICATED_GROUP_NAME)
      ]
    } as unknown as MihomoConfig

    orderProxyGroups(profile)

    assert.deepEqual(namesOf(profile), [
      MAIL_DEDICATED_GROUP_NAME,
      MAIL_PROBE_HIDDEN_GROUP_NAME,
      'Sparkle-美国',
      'Sparkle-日本',
      '🔍 Google',
      '⌨️ GitHub'
    ])
  })

  it('is idempotent and tolerates a missing/empty group list', () => {
    const profile = {
      'proxy-groups': [group('🐟 漏网之鱼'), group(AUTO_SELECT_GROUP_NAME)]
    } as unknown as MihomoConfig
    orderProxyGroups(profile)
    const once = namesOf(profile)
    orderProxyGroups(profile)

    assert.deepEqual(namesOf(profile), once)
    assert.deepEqual(once, [AUTO_SELECT_GROUP_NAME, '🐟 漏网之鱼'])

    const empty = { 'proxy-groups': [] } as unknown as MihomoConfig
    orderProxyGroups(empty)
    assert.deepEqual(namesOf(empty), [])

    orderProxyGroups({} as MihomoConfig)
  })
})
