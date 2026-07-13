import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_REGION_PRIORITY,
  buildRegionProviderFilter,
  nodeMatchesRegion,
  normalizeRegionPriority,
  resolveEffectiveRegionPriority
} from './regionPriority'

describe('regionPriority', () => {
  it('defaults to SG → JP → TW → KR → US', () => {
    assert.deepEqual(DEFAULT_REGION_PRIORITY, ['新加坡', '日本', '台湾', '韩国', '美国'])
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
