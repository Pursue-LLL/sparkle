import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_REGION_PRIORITY,
  buildAutoSelectCountryFilter,
  buildRegionProviderFilter,
  extractRegionKeywords,
  isBlockedRegionNodeName,
  nodeMatchesRegion,
  normalizeRegionPriority,
  resolveEffectiveRegionPriority
} from './regionPriority'

describe('regionPriority', () => {
  it('defaults to JP → TW → KR → SG → US (实测日本节点最稳)', () => {
    assert.deepEqual(DEFAULT_REGION_PRIORITY, ['台湾', '日本', '韩国', '新加坡', '美国'])
  })

  it('matches commercial node naming patterns', () => {
    assert.equal(nodeMatchesRegion('🇭🇰 新加坡 V2 | 深港专线', '新加坡'), true)
    assert.equal(nodeMatchesRegion('🇯🇵 日本 V1 | 亚太隧道', '日本'), true)
    assert.equal(nodeMatchesRegion('🇭🇰 台湾 M1 | 港澳B站', '台湾'), true)
    assert.equal(nodeMatchesRegion('🇰🇷 韩国 M1 | 深港隧道', '韩国'), true)
    assert.equal(nodeMatchesRegion('KR-VPS-HY2', '韩国'), true)
    assert.equal(nodeMatchesRegion('TW-Node-01 | ChatGPT', '台湾'), true)
    assert.equal(nodeMatchesRegion('SG-HY2 | 直连', '新加坡'), true)
    assert.equal(nodeMatchesRegion('🇹🇼台湾-01 T 1.0x', '台湾'), true)
    assert.equal(nodeMatchesRegion('🇯🇵日本-02 S 1.0x', 'JP'), true)
    assert.equal(nodeMatchesRegion('KR-VPS-HY2', 'KR'), true)
    assert.equal(nodeMatchesRegion('SG-01', 'SG'), true)
    assert.equal(nodeMatchesRegion('20 韩国 11 |IEPL、ChatGP', '韩国'), true)
    assert.equal(nodeMatchesRegion('🇯🇵 美国 M1 | 皖日隧道、Netflix(US)、SVIP | 3x', '美国'), true)
    assert.equal(nodeMatchesRegion('US-VPS-HY2', 'US'), true)
  })

  it('uses word boundaries for short region codes', () => {
    assert.equal(nodeMatchesRegion('message', '新加坡'), false)
    assert.equal(nodeMatchesRegion('TW-01', '台湾'), true)
  })

  it('filters blocked Hong Kong entries from custom priority', () => {
    assert.deepEqual(normalizeRegionPriority(['香港', '新加坡']), ['新加坡'])
  })

  it('appends missing default regions for persisted partial priority lists', () => {
    assert.deepEqual(resolveEffectiveRegionPriority(['新加坡', '日本', '台湾', '韩国']), [
      '新加坡',
      '日本',
      '台湾',
      '韩国',
      '美国'
    ])
  })

  it('builds US provider filter with word boundaries', () => {
    assert.match(buildRegionProviderFilter('美国') ?? '', /\\bUS\\b/)
    assert.match(buildRegionProviderFilter('美国') ?? '', /美国/)
  })

  it('does not misclassify unrelated node names as US', () => {
    assert.equal(nodeMatchesRegion('message relay node', '美国'), false)
    assert.equal(nodeMatchesRegion('focus group alpha', '美国'), false)
  })

  it('prefers headline Chinese region over SG emoji or Netflix(SG) suffix', () => {
    const malaysiaNode = '🇸🇬 马来西亚 B15 | 皖日隧道、ChatGPT、Netflix(SG) | 3x'
    assert.equal(nodeMatchesRegion(malaysiaNode, '新加坡'), false)
    assert.equal(nodeMatchesRegion(malaysiaNode, '日本'), false)
  })

  it('matches region keywords only in headline, not service tags after |', () => {
    assert.equal(nodeMatchesRegion('Relay Node | Netflix(SG)', '新加坡'), false)
    assert.equal(nodeMatchesRegion('Relay Node | ChatGPT(SG)', '新加坡'), false)
  })
})

describe('regionPriority: blocked regions and the auto-select country filter', () => {
  it('recognizes Hong Kong in Chinese and Latin spellings, case-insensitively', () => {
    assert.equal(isBlockedRegionNodeName('🇭🇰 香港 01'), true)
    assert.equal(isBlockedRegionNodeName('HongKong-02'), true)
    assert.equal(isBlockedRegionNodeName('HONG KONG 03'), true)
    assert.equal(isBlockedRegionNodeName('🇯🇵 日本 01'), false)
  })

  it('lists the five default regions and the extra countries, never Hong Kong', () => {
    const filter = buildAutoSelectCountryFilter()

    for (const region of DEFAULT_REGION_PRIORITY) {
      assert.ok(filter.includes(buildRegionProviderFilter(region) ?? '<none>'), region)
    }
    assert.ok(filter.includes('英国|德国|法国'))
    assert.ok(filter.endsWith('|埃及|南非'))
    assert.equal(filter.includes('香港'), false)
  })
})

describe('regionPriority: headline markers', () => {
  it('lets the first marker of the headline decide, in table order', () => {
    assert.equal(nodeMatchesRegion('日本台湾 01', '日本'), true)
    assert.equal(nodeMatchesRegion('日本台湾 01', '台湾'), false)
    assert.equal(nodeMatchesRegion('新加坡马来西亚 01', '新加坡'), false)
  })

  it('never matches a Hong Kong or Malaysia headline, whatever the target', () => {
    assert.equal(nodeMatchesRegion('香港日本 01', '日本'), false)
    assert.equal(nodeMatchesRegion('马来西亚 01', '新加坡'), false)
  })

  it('accepts the Latin code of the target region for an explicit headline', () => {
    assert.equal(nodeMatchesRegion('日本 01', 'jp'), true)
    assert.equal(nodeMatchesRegion('日本 01', 'KR'), false)
  })
})

describe('regionPriority: regions outside the default five', () => {
  it('returns the alias list of a default region as a copy', () => {
    const keywords = extractRegionKeywords('日本')
    keywords.push('changed')

    assert.deepEqual(extractRegionKeywords('日本'), ['日本', 'jp', 'japan', '🇯🇵'])
    assert.deepEqual(extractRegionKeywords('JP'), ['日本', 'jp', 'japan', '🇯🇵'])
  })

  it('derives keywords for a custom region from its Chinese words and Latin names', () => {
    assert.deepEqual(extractRegionKeywords('德国'), ['德国'])
    assert.deepEqual(extractRegionKeywords('美国西部 US'), ['美国西部', 'us'])
    assert.deepEqual(extractRegionKeywords('Taiwan 2'), ['taiwan'])
    assert.deepEqual(extractRegionKeywords('Germany'), [])
  })

  it('matches a region without keywords by plain substring, in either direction', () => {
    assert.equal(nodeMatchesRegion('Germany 01', 'germany'), true)
    assert.equal(nodeMatchesRegion('many', 'Germany'), true)
    assert.equal(nodeMatchesRegion('France 01', 'Germany'), false)
  })

  it('builds provider filters for custom regions only when keywords exist', () => {
    assert.equal(buildRegionProviderFilter('新加坡'), '新加坡|(?i)\\bSG\\b|singapore')
    assert.equal(buildRegionProviderFilter('德国'), '德国')
    assert.equal(buildRegionProviderFilter('美国西部 US'), '美国西部|us')
    assert.equal(buildRegionProviderFilter('Germany'), undefined)
  })
})

describe('regionPriority: priority list fallback and node name matching details', () => {
  it('falls back to a fresh copy of the defaults when nothing survives the filter', () => {
    const fallback = normalizeRegionPriority(['香港', 'Hong Kong'])

    assert.deepEqual(fallback, [...DEFAULT_REGION_PRIORITY])
    fallback.pop()
    assert.deepEqual(normalizeRegionPriority([]), [...DEFAULT_REGION_PRIORITY])
  })

  it('reads the headline up to the first pipe, trimmed, even when the name has no pipe', () => {
    assert.equal(nodeMatchesRegion('专线 日本', '日本'), true)
    assert.equal(nodeMatchesRegion('  日本 | 专线', '日本'), true)
    assert.equal(nodeMatchesRegion('|日本节点', '日本'), false)
  })

  it('matches long Latin names and flags anywhere in the headline, case-insensitively', () => {
    assert.equal(nodeMatchesRegion('Japan01', '日本'), true)
    assert.equal(nodeMatchesRegion('SINGAPORE-node', '新加坡'), true)
    assert.equal(nodeMatchesRegion('United States 01', '美国'), true)
    assert.equal(nodeMatchesRegion('🇯🇵 01', '日本'), true)
  })

  it('keeps short Latin codes from matching inside longer words or glued digits', () => {
    assert.equal(nodeMatchesRegion('JP01', '日本'), false)
    assert.equal(nodeMatchesRegion('jp-01', '日本'), true)
    assert.equal(nodeMatchesRegion('node us', '美国'), true)
    assert.equal(nodeMatchesRegion('usage', '美国'), false)
  })
})
