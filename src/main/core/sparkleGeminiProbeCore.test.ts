import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateGeminiHtmlEligibility,
  isGeminiCountryCodeEligible,
  resolveGeminiBlockedNodeNames,
  type GeminiRegionProbeRecord
} from './sparkleGeminiProbeCore'

describe('sparkleGeminiProbeCore', () => {
  it('accepts supported Gemini country codes and rejects blocked or unknown codes', () => {
    assert.equal(isGeminiCountryCodeEligible('TW'), true)
    assert.equal(isGeminiCountryCodeEligible('JP'), true)
    assert.equal(isGeminiCountryCodeEligible('SG'), true)
    assert.equal(isGeminiCountryCodeEligible('US'), true)
    assert.equal(isGeminiCountryCodeEligible('CA'), true)
    assert.equal(isGeminiCountryCodeEligible('KR'), true)

    assert.equal(isGeminiCountryCodeEligible('ZZ'), false)
    assert.equal(isGeminiCountryCodeEligible('CN'), false)
    assert.equal(isGeminiCountryCodeEligible('HK'), false)
    assert.equal(isGeminiCountryCodeEligible('MO'), false)
    assert.equal(isGeminiCountryCodeEligible('RU'), false)
    assert.equal(isGeminiCountryCodeEligible('BY'), false)
    assert.equal(isGeminiCountryCodeEligible(''), false)
  })

  it('returns settled=false when vXmutd marker has not arrived in the stream yet', () => {
    const partial = '<!doctype html><html><head><script>window.WIZ_global_data={"OewCAd":"1"'
    const res = evaluateGeminiHtmlEligibility(partial)
    assert.deepEqual(res, { settled: false, eligible: false })
  })

  it('evaluates eligible=true when vXmutd reports a supported region like TW or JP', () => {
    const twHtml =
      'window.WIZ_global_data={"TSDtV":"%.@.]","vXmutd":"%.@.\\"TW\\",\\"ZZ\\",\\"aBzGBQ\\\\u003d\\\\u003d\\"]"};'
    assert.deepEqual(evaluateGeminiHtmlEligibility(twHtml), {
      settled: true,
      eligible: true,
      countryCode: 'TW'
    })

    const jpHtml =
      'window.WIZ_global_data={"vXmutd":"%.@.\\"JP\\",\\"ZZ\\",\\"JAfNwJ2dwsCLJzSHT5MDSA\\\\u003d\\\\u003d\\"]"};'
    assert.deepEqual(evaluateGeminiHtmlEligibility(jpHtml), {
      settled: true,
      eligible: true,
      countryCode: 'JP'
    })
  })

  it('evaluates eligible=false when vXmutd reports ZZ (sent-to-CN) or HK', () => {
    const zzHtml =
      'window.WIZ_global_data={"vXmutd":"%.@.\\"ZZ\\",\\"ZZ\\",\\"JACJAgAAAAAgACj//rAnnQ\\\\u003d\\\\u003d\\"]"};'
    assert.deepEqual(evaluateGeminiHtmlEligibility(zzHtml), {
      settled: true,
      eligible: false,
      countryCode: 'ZZ'
    })

    const hkHtml =
      'window.WIZ_global_data={"vXmutd":"%.@.\\"HK\\",\\"ZZ\\",\\"abc\\\\u003d\\\\u003d\\"]"};'
    assert.deepEqual(evaluateGeminiHtmlEligibility(hkHtml), {
      settled: true,
      eligible: false,
      countryCode: 'HK'
    })
  })

  it('evaluates eligible=false immediately if google.cn OneGoogleBar or LQaXg blocked module is present', () => {
    const cnOgbHtml = '<a href="https://www.google.cn/intl/zh-CN/about/products">Google</a>'
    assert.deepEqual(evaluateGeminiHtmlEligibility(cnOgbHtml), {
      settled: true,
      eligible: false,
      countryCode: 'CN'
    })

    const blockedModHtml =
      '<link rel="preload" href="https://www.gstatic.com/_/mss/boq-bard-web/_/js/k=boq-bard-web.BardChatUi.zh_CN.1/dti=1/m=LQaXg">'
    assert.deepEqual(evaluateGeminiHtmlEligibility(blockedModHtml), {
      settled: true,
      eligible: false,
      countryCode: 'CN'
    })
  })

  it('resolves blocked node names from cache by fingerprint or node name', () => {
    const proxies = [
      {
        name: '🇸🇬 日本 V0 | 移动优化、新开机 | 2x',
        type: 'trojan',
        server: '172.104.110.31',
        port: 26160
      },
      {
        name: '🇯🇵 日本 I3 | AI、Netflix(JP)、SVIP | 3x',
        type: 'trojan',
        server: '211.90.241.37',
        port: 48131
      },
      {
        name: '🇰🇷 韩国 I1 | IEPL、ChatGPT、动态IP | 3x',
        type: 'trojan',
        server: '27.44.143.224',
        port: 28600
      }
    ]
    const cache = new Map<string, GeminiRegionProbeRecord>([
      [
        '🇸🇬 日本 V0 | 移动优化、新开机 | 2x|trojan|172.104.110.31|26160',
        { eligible: false, countryCode: 'ZZ', checkedAt: 1000 }
      ],
      [
        '🇯🇵 日本 I3 | AI、Netflix(JP)、SVIP | 3x|trojan|211.90.241.37|48131',
        { eligible: true, countryCode: 'JP', checkedAt: 1000 }
      ],
      [
        '🇰🇷 韩国 I1 | IEPL、ChatGPT、动态IP | 3x',
        { eligible: false, countryCode: 'ZZ', checkedAt: 1000 }
      ]
    ])

    const blocked = resolveGeminiBlockedNodeNames(proxies, cache)
    assert.deepEqual(
      [...blocked],
      ['🇸🇬 日本 V0 | 移动优化、新开机 | 2x', '🇰🇷 韩国 I1 | IEPL、ChatGPT、动态IP | 3x']
    )
  })
})
