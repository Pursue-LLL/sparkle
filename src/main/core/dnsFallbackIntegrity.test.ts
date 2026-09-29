import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensureDnsFallbackIntegrity, ensureTunStrictRoute } from './dnsFallbackIntegrity'

describe('dnsFallbackIntegrity', () => {
  it('injects fallback and geoip fallback-filter when missing', () => {
    const profile = {
      dns: {
        enable: true,
        nameserver: ['https://doh.pub/dns-query']
      }
    } as unknown as MihomoConfig
    ensureDnsFallbackIntegrity(profile)
    assert.deepEqual(profile.dns?.fallback, [
      'tls://223.5.5.5',
      'tls://1.1.1.1',
      'https://1.1.1.1/dns-query',
      'https://8.8.8.8/dns-query',
      'https://dns.google/dns-query'
    ])
    const filter = profile.dns?.['fallback-filter'] as NonNullable<
      MihomoDNSConfig['fallback-filter']
    >
    assert.equal(filter.geoip, false)
    assert.ok((filter.domain as string[] | undefined)?.includes('+.google.com'))
    assert.ok(!(filter.domain as string[] | undefined)?.includes('+.chatgpt.com'))
  })

  it('preserves subscription fallback and merges filter domains', () => {
    const profile = {
      dns: {
        enable: true,
        fallback: ['https://1.0.0.1/dns-query'],
        'fallback-filter': {
          geoip: true,
          'geoip-code': 'CN',
          domain: ['+.example.com']
        }
      }
    } as unknown as MihomoConfig
    ensureDnsFallbackIntegrity(profile)
    assert.deepEqual(profile.dns?.fallback, ['https://1.0.0.1/dns-query'])
    const filter = profile.dns?.['fallback-filter'] as NonNullable<
      MihomoDNSConfig['fallback-filter']
    >
    assert.ok((filter.domain as string[] | undefined)?.includes('+.example.com'))
    assert.ok((filter.domain as string[] | undefined)?.includes('+.google.com'))
  })

  it('forces strict-route when tun is enabled', () => {
    const profile = {
      tun: { enable: true, stack: 'system' }
    } as unknown as MihomoConfig
    ensureTunStrictRoute(profile)
    assert.equal(profile.tun?.['strict-route'], true)
  })

  it('skips when dns is disabled', () => {
    const profile = { dns: { enable: false } } as unknown as MihomoConfig
    ensureDnsFallbackIntegrity(profile)
    assert.equal(profile.dns?.fallback, undefined)
  })

  it('prepends UDP/TLS bootstrap when default-nameserver is DoH-only', () => {
    const profile = {
      dns: {
        enable: true,
        'default-nameserver': ['https://1.1.1.1/dns-query'],
        nameserver: ['https://8.8.8.8/dns-query'],
        'proxy-server-nameserver': ['https://dns.google/dns-query']
      }
    } as unknown as MihomoConfig
    ensureDnsFallbackIntegrity(profile)
    assert.deepEqual(profile.dns?.['default-nameserver'], [
      '223.5.5.5',
      '1.1.1.1',
      'https://1.1.1.1/dns-query'
    ])
    assert.deepEqual(profile.dns?.nameserver?.slice(0, 2), [
      'tls://223.5.5.5',
      'tls://1.1.1.1'
    ])
  })

  it('preserves existing UDP bootstrap nameservers', () => {
    const profile = {
      dns: {
        enable: true,
        'default-nameserver': ['223.5.5.5'],
        nameserver: ['tls://223.5.5.5', 'https://1.1.1.1/dns-query']
      }
    } as unknown as MihomoConfig
    ensureDnsFallbackIntegrity(profile)
    assert.deepEqual(profile.dns?.['default-nameserver'], ['223.5.5.5'])
    assert.deepEqual(profile.dns?.nameserver, ['tls://223.5.5.5'])
  })
})
