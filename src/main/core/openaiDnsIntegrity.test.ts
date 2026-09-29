import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ensureOpenAiDnsIntegrity,
  mergeProxyDomainNameserverPolicy,
  PROXY_DOMAIN_NAMESERVER_POLICY
} from './openaiDnsIntegrity'

describe('openaiDnsIntegrity', () => {
  it('merges proxy domains into nameserver-policy', () => {
    const merged = mergeProxyDomainNameserverPolicy({
      '+.cursor.sh': ['https://dns.alidns.com/dns-query']
    })
    assert.deepEqual(merged['+.cursor.sh'], ['https://dns.alidns.com/dns-query'])
    assert.deepEqual(merged['+.google.com'], [...PROXY_DOMAIN_NAMESERVER_POLICY['+.google.com']])
    assert.deepEqual(merged['+.chatgpt.com'], [...PROXY_DOMAIN_NAMESERVER_POLICY['+.chatgpt.com']])
  })

  it('injects OpenAI nameserver-policy into runtime profile dns', () => {
    const profile = {
      dns: {
        enable: true,
        nameserver: ['https://doh.pub/dns-query']
      }
    } as unknown as MihomoConfig
    ensureOpenAiDnsIntegrity(profile)
    const policy = profile.dns?.['nameserver-policy'] as Record<string, string[]>
    assert.deepEqual(policy['+.chatgpt.com'], [...PROXY_DOMAIN_NAMESERVER_POLICY['+.chatgpt.com']])
  })

  it('skips when dns is disabled', () => {
    const profile = { dns: { enable: false } } as unknown as MihomoConfig
    ensureOpenAiDnsIntegrity(profile)
    assert.equal(profile.dns?.['nameserver-policy'], undefined)
  })
})
