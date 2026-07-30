import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CORPORATE_NAMESERVER_FALLBACK,
  isPrivateIpv4DnsServer,
  parseDhcpDnsServersFromIpconfig,
  parsePrivateDnsServers,
  resolveCorporateNameservers
} from './corporateDnsCore'

describe('corporateDnsCore', () => {
  it('detects RFC1918 DNS servers', () => {
    assert.equal(isPrivateIpv4DnsServer('10.200.150.212'), true)
    assert.equal(isPrivateIpv4DnsServer('172.25.66.1'), true)
    assert.equal(isPrivateIpv4DnsServer('192.168.1.1'), true)
    assert.equal(isPrivateIpv4DnsServer('223.5.5.5'), false)
  })

  it('parses originDNS private resolvers', () => {
    assert.deepEqual(parsePrivateDnsServers('10.200.150.212 10.200.150.211 223.5.5.5'), [
      '10.200.150.212',
      '10.200.150.211'
    ])
    assert.deepEqual(parsePrivateDnsServers('Empty'), [])
  })

  it('parses DHCP domain_name_server block', () => {
    const sample = `
domain_name_server (ip_mult): {10.200.150.212, 10.200.150.211}
domain_name (string): staff.neworiental.org
`
    assert.deepEqual(parseDhcpDnsServersFromIpconfig(sample), [
      '10.200.150.212',
      '10.200.150.211'
    ])
  })

  it('prefers originDNS over DHCP and fallback', () => {
    assert.deepEqual(
      resolveCorporateNameservers({
        originDns: '10.203.1.1',
        dhcpDns: ['10.200.150.212']
      }),
      ['10.203.1.1']
    )
    assert.deepEqual(
      resolveCorporateNameservers({
        dhcpDns: ['10.200.150.212', '10.200.150.211']
      }),
      ['10.200.150.212', '10.200.150.211']
    )
    assert.deepEqual(resolveCorporateNameservers({}), [...CORPORATE_NAMESERVER_FALLBACK])
  })
})
