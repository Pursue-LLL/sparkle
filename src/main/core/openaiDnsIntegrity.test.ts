import { describe, expect, it } from 'vitest'
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
    expect(merged['+.cursor.sh']).toEqual(['https://dns.alidns.com/dns-query'])
    expect(merged['+.google.com']).toEqual([...PROXY_DOMAIN_NAMESERVER_POLICY['+.google.com']])
    expect(merged['+.chatgpt.com']).toEqual([...PROXY_DOMAIN_NAMESERVER_POLICY['+.chatgpt.com']])
  })

  it('injects OpenAI nameserver-policy into runtime profile dns', () => {
    const profile: MihomoConfig = {
      dns: {
        enable: true,
        nameserver: ['https://doh.pub/dns-query']
      }
    }
    ensureOpenAiDnsIntegrity(profile)
    const policy = profile.dns?.['nameserver-policy'] as Record<string, string[]>
    expect(policy['+.chatgpt.com']).toEqual([...PROXY_DOMAIN_NAMESERVER_POLICY['+.chatgpt.com']])
  })

  it('skips when dns is disabled', () => {
    const profile: MihomoConfig = { dns: { enable: false } }
    ensureOpenAiDnsIntegrity(profile)
    expect(profile.dns?.['nameserver-policy']).toBeUndefined()
  })
})
