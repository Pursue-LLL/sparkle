import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUTO_SELECT_EXCLUDED_NODE_TYPES,
  buildRegionalAutoSelectGroupName,
  buildRegionalUrlTestGroup,
  type RegionalGroupProbe
} from './regionalAutoSelectGroupsCore'

const PROBE: RegionalGroupProbe = {
  url: 'https://gemini.google.com',
  interval: 300,
  tolerance: 2000,
  timeout: 5000
}

const CATALOG = [
  { name: '🇸🇬 新加坡 01', type: 'anytls' },
  { name: '🇸🇬 新加坡 02', type: 'hysteria2' },
  { name: '🇸🇬 新加坡 03', type: 'trojan' },
  { name: '🇸🇬 新加坡 03', type: 'trojan' },
  { name: '🇯🇵 日本 01', type: 'Hysteria2' },
  { name: '🇯🇵 日本 02', type: 'anytls' }
]

describe('regionalAutoSelectGroupsCore', () => {
  it('excludes hysteria2 and anytls from automatic selection', () => {
    assert.deepEqual([...AUTO_SELECT_EXCLUDED_NODE_TYPES], ['hysteria2', 'anytls'])
    assert.equal(buildRegionalAutoSelectGroupName('日本'), 'Sparkle-日本')
  })

  it('builds a sticky url-test group over the subscription provider', () => {
    const group = buildRegionalUrlTestGroup(
      '新加坡',
      { profileId: 'p1', catalog: CATALOG },
      PROBE
    )

    assert.deepEqual(group, {
      name: 'Sparkle-新加坡',
      type: 'url-test',
      ...PROBE,
      lazy: true,
      use: ['p1'],
      filter: '新加坡|(?i)\\bSG\\b|singapore',
      'exclude-type': 'hysteria2|anytls'
    })
  })

  it('returns null for a region whose nodes are all excluded types (case-insensitive)', () => {
    assert.equal(buildRegionalUrlTestGroup('日本', { profileId: 'p1', catalog: CATALOG }, PROBE), null)
    assert.equal(buildRegionalUrlTestGroup('日本', { catalog: CATALOG }, PROBE), null)
  })

  it('returns null for a region with no node at all', () => {
    assert.equal(
      buildRegionalUrlTestGroup('美国', { profileId: 'p1', leafNames: ['SG-01'] }, PROBE),
      null
    )
  })

  it('keeps the provider group when node names are unknown', () => {
    const group = buildRegionalUrlTestGroup('日本', { profileId: 'p1' }, PROBE)
    assert.deepEqual(group?.use, ['p1'])
  })

  it('lists deduplicated eligible nodes inline without a profile', () => {
    const fromCatalog = buildRegionalUrlTestGroup('新加坡', { catalog: CATALOG }, PROBE)
    assert.deepEqual(fromCatalog?.proxies, ['🇸🇬 新加坡 03'])
    assert.equal(fromCatalog?.use, undefined)

    const fromNames = buildRegionalUrlTestGroup('日本', { leafNames: ['SG-01', 'JP-01'] }, PROBE)
    assert.deepEqual(fromNames?.proxies, ['JP-01'])
  })

  it('returns null without a profile when nothing is known about the nodes', () => {
    assert.equal(buildRegionalUrlTestGroup('日本', {}, PROBE), null)
  })
})
