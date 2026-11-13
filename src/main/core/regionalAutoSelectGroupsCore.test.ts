import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
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
  { name: '🇯🇵 日本 01', type: 'AnyTLS' }
]

describe('regionalAutoSelectGroupsCore', () => {
  it('names groups with the Sparkle- prefix', () => {
    assert.equal(buildRegionalAutoSelectGroupName('日本'), 'Sparkle-日本')
  })

  it('builds a url-test group over the subscription provider with no protocol exclusion', () => {
    const group = buildRegionalUrlTestGroup('新加坡', { profileId: 'p1', catalog: CATALOG }, PROBE)

    assert.deepEqual(group, {
      name: 'Sparkle-新加坡',
      type: 'url-test',
      ...PROBE,
      lazy: true,
      use: ['p1'],
      filter: '新加坡|(?i)\\bSG\\b|singapore'
    })
  })

  it('builds a group for a region whose only node is anytls', () => {
    const withProfile = buildRegionalUrlTestGroup('日本', { profileId: 'p1', catalog: CATALOG }, PROBE)
    assert.deepEqual(withProfile?.use, ['p1'])
    const inline = buildRegionalUrlTestGroup('日本', { catalog: CATALOG }, PROBE)
    assert.deepEqual(inline?.proxies, ['🇯🇵 日本 01'])
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

  it('lists deduplicated nodes inline without a profile, keeping every protocol', () => {
    const fromCatalog = buildRegionalUrlTestGroup('新加坡', { catalog: CATALOG }, PROBE)
    assert.deepEqual(fromCatalog?.proxies, ['🇸🇬 新加坡 01', '🇸🇬 新加坡 02', '🇸🇬 新加坡 03'])
    assert.equal(fromCatalog?.use, undefined)

    const fromNames = buildRegionalUrlTestGroup('日本', { leafNames: ['SG-01', 'JP-01'] }, PROBE)
    assert.deepEqual(fromNames?.proxies, ['JP-01'])
  })

  it('returns null without a profile when nothing is known about the nodes', () => {
    assert.equal(buildRegionalUrlTestGroup('日本', {}, PROBE), null)
  })
})
