import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appendExcludeProxyNamesToProviderFilter,
  buildNonAnyTlsRegionalMembers,
  excludeAnyTlsFromAutoSelectUrlTestGroups,
  isAnyTlsProxyType,
  isAutoSelectUrlTestGroupName,
} from './autoSelectAnyTlsExclusionCore'

const CATALOG = [
  { name: '🇸🇬 新加坡 01', type: 'anytls' },
  { name: '🇸🇬 新加坡 02', type: 'hysteria2' },
  { name: '🇯🇵 日本 01', type: 'anytls' },
  { name: '🇯🇵 日本 02', type: 'hysteria2' },
] as const

describe('autoSelectAnyTlsExclusionCore', () => {
  it('detects anytls proxy type', () => {
    assert.equal(isAnyTlsProxyType('anytls'), true)
    assert.equal(isAnyTlsProxyType('AnyTLS'), true)
    assert.equal(isAnyTlsProxyType('hysteria2'), false)
  })

  it('recognizes url-test auto-select group names only', () => {
    assert.equal(isAutoSelectUrlTestGroupName('Sparkle-新加坡', 'url-test'), true)
    assert.equal(isAutoSelectUrlTestGroupName('自动选择', 'url-test'), true)
    assert.equal(isAutoSelectUrlTestGroupName('🤖 AI', 'select'), false)
    assert.equal(isAutoSelectUrlTestGroupName('Sparkle-新加坡', 'select'), false)
  })

  it('builds regional members without anytls', () => {
    assert.deepEqual(buildNonAnyTlsRegionalMembers('新加坡', [...CATALOG]), ['🇸🇬 新加坡 02'])
    assert.deepEqual(buildNonAnyTlsRegionalMembers('日本', [...CATALOG]), ['🇯🇵 日本 02'])
  })

  it('strips anytls from url-test proxy lists but not select groups', () => {
    const groups = [
      {
        name: 'Sparkle-新加坡',
        type: 'url-test',
        proxies: ['🇸🇬 新加坡 01', '🇸🇬 新加坡 02'],
      },
      { name: '🤖 AI', type: 'select', proxies: ['🇸🇬 新加坡 01', '🇸🇬 新加坡 02'] },
    ]
    const result = excludeAnyTlsFromAutoSelectUrlTestGroups(groups, [...CATALOG])
    assert.equal(result.groupsMutated, 1)
    assert.equal(result.proxiesRemoved, 1)
    assert.deepEqual(groups[0]?.proxies, ['🇸🇬 新加坡 02'])
    assert.deepEqual(groups[1]?.proxies, ['🇸🇬 新加坡 01', '🇸🇬 新加坡 02'])
  })

  it('materializes provider-mode regional url-test without anytls', () => {
    const groups: Array<{
      name: string
      type: string
      use: string[]
      filter: string
      proxies?: string[]
    }> = [
      {
        name: 'Sparkle-新加坡',
        type: 'url-test',
        use: ['77caf1sub001'],
        filter: '新加坡|(?i)\\bSG\\b|singapore',
      },
    ]
    const result = excludeAnyTlsFromAutoSelectUrlTestGroups(groups, [...CATALOG])
    assert.equal(result.groupsMutated, 1)
    assert.deepEqual(groups[0]?.use, ['77caf1sub001'])
    assert.equal(
      groups[0]?.filter,
      appendExcludeProxyNamesToProviderFilter(
        '新加坡|(?i)\\bSG\\b|singapore',
        ['🇸🇬 新加坡 01'],
      ),
    )
    assert.equal(groups[0]?.proxies, undefined)
  })

  it('noops when catalog lacks proxy types', () => {
    const groups = [
      {
        name: 'Sparkle-新加坡',
        type: 'url-test',
        proxies: ['🇸🇬 新加坡 01', '🇸🇬 新加坡 02'],
      },
    ]
    const result = excludeAnyTlsFromAutoSelectUrlTestGroups(groups, [
      { name: '🇸🇬 新加坡 01' },
      { name: '🇸🇬 新加坡 02' },
    ])
    assert.equal(result.groupsMutated, 0)
    assert.deepEqual(groups[0]?.proxies, ['🇸🇬 新加坡 01', '🇸🇬 新加坡 02'])
  })

  it('removes url-test group when every member is anytls and prunes select refs', () => {
    const groups = [
      {
        name: 'Sparkle-测试区',
        type: 'url-test',
        proxies: ['测试 01'],
      },
      {
        name: '🤖 AI',
        type: 'select',
        proxies: ['Sparkle-测试区', '测试 02'],
      },
    ]
    const result = excludeAnyTlsFromAutoSelectUrlTestGroups(groups, [
      { name: '测试 01', type: 'anytls' },
      { name: '测试 02', type: 'hysteria2' },
    ])
    assert.equal(result.groupsRemoved.length, 1)
    assert.equal(groups.some((group) => group.name === 'Sparkle-测试区'), false)
    assert.deepEqual(groups.find((group) => group.name === '🤖 AI')?.proxies, ['测试 02'])
  })

  it('strips anytls from fallback auto-hop groups', () => {
    const groups = [
      {
        name: '故障转移',
        type: 'fallback',
        proxies: ['🇸🇬 新加坡 01', '🇸🇬 新加坡 02'],
      },
    ]
    const result = excludeAnyTlsFromAutoSelectUrlTestGroups(groups, [...CATALOG])
    assert.equal(result.groupsMutated, 1)
    assert.deepEqual(groups[0]?.proxies, ['🇸🇬 新加坡 02'])
  })
})
