import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideRuntimeConfigReload,
  fingerprintRuntimeConfig,
  type RuntimeConfigSyncFacts
} from './runtimeConfigSyncCore'

function config(overrides: Record<string, unknown> = {}): MihomoConfig {
  return {
    rules: ['GEOIP,CN,DIRECT', 'MATCH,🚀 节点选择'],
    'proxy-groups': [{ name: '🚀 节点选择', type: 'select', proxies: ['DIRECT'] }],
    'proxy-providers': { main: { type: 'file', path: './main.yaml' } },
    dns: { enable: true },
    ...overrides
  } as unknown as MihomoConfig
}

describe('fingerprintRuntimeConfig', () => {
  it('is stable for identical configs', () => {
    assert.equal(fingerprintRuntimeConfig(config()), fingerprintRuntimeConfig(config()))
  })

  it('changes when a rule is edited, reordered or retargeted', () => {
    const base = fingerprintRuntimeConfig(config())

    assert.notEqual(
      base,
      fingerprintRuntimeConfig(config({ rules: ['GEOIP,CN,DIRECT', 'MATCH,DIRECT'] }))
    )
    assert.notEqual(
      base,
      fingerprintRuntimeConfig(config({ rules: ['MATCH,🚀 节点选择', 'GEOIP,CN,DIRECT'] }))
    )
  })

  it('changes when groups, providers or rule-providers change', () => {
    const base = fingerprintRuntimeConfig(config())

    assert.notEqual(
      base,
      fingerprintRuntimeConfig(config({ 'proxy-groups': [{ name: 'x', type: 'select' }] }))
    )
    assert.notEqual(
      base,
      fingerprintRuntimeConfig(
        config({ 'proxy-providers': { main: { type: 'file' }, 'main-vps': { type: 'file' } } })
      )
    )
    assert.notEqual(
      base,
      fingerprintRuntimeConfig(config({ 'rule-providers': { cn: { type: 'http' } } }))
    )
  })

  it('ignores sections that have their own update path', () => {
    assert.equal(
      fingerprintRuntimeConfig(config()),
      fingerprintRuntimeConfig(config({ dns: { enable: false }, 'mixed-port': 7891 }))
    )
  })
})

describe('decideRuntimeConfigReload', () => {
  const facts = (overrides: Partial<RuntimeConfigSyncFacts>): RuntimeConfigSyncFacts => ({
    diskFingerprint: 'new',
    diskRuleCount: 3788,
    appliedFingerprint: 'new',
    liveRuleCount: 3788,
    ...overrides
  })

  it('keeps the core when disk and live agree', () => {
    assert.equal(decideRuntimeConfigReload(facts({})), null)
  })

  it('reloads when the config changed inside this process', () => {
    assert.equal(decideRuntimeConfigReload(facts({ appliedFingerprint: 'old' })), 'config-changed')
  })

  it('reloads a kept stale core whose rule count disagrees with disk (131 vs 3788)', () => {
    assert.equal(
      decideRuntimeConfigReload(facts({ appliedFingerprint: undefined, liveRuleCount: 131 })),
      'live-rule-count-mismatch'
    )
  })

  it('reloads when the core was restarted behind our back and no longer matches disk', () => {
    assert.equal(decideRuntimeConfigReload(facts({ liveRuleCount: 0 })), 'live-rule-count-mismatch')
  })

  it('does not guess when the core is unreachable and nothing was applied yet', () => {
    assert.equal(
      decideRuntimeConfigReload(facts({ appliedFingerprint: undefined, liveRuleCount: undefined })),
      null
    )
  })

  it('adopts an unknown but count-matching core without reloading', () => {
    assert.equal(decideRuntimeConfigReload(facts({ appliedFingerprint: undefined })), null)
  })
})
