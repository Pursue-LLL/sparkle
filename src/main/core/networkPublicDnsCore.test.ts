import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PUBLIC_DNS_SERVERS,
  publicDnsServerList,
  shouldPersistOriginDns
} from './networkPublicDnsCore'

describe('networkPublicDnsCore', () => {
  it('captures origin DNS only when missing', () => {
    assert.equal(shouldPersistOriginDns(undefined), true)
    assert.equal(shouldPersistOriginDns('172.24.210.11 172.24.211.14'), false)
    assert.equal(shouldPersistOriginDns('Empty'), false)
  })

  it('uses dual public DNS servers for TUN bootstrap', () => {
    assert.equal(PUBLIC_DNS_SERVERS, '223.5.5.5 1.1.1.1')
    assert.deepEqual(publicDnsServerList(), ['223.5.5.5', '1.1.1.1'])
  })
})
