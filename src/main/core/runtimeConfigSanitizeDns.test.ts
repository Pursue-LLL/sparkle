import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clean, type Fields } from './runtimeConfigSanitizeHarness'

describe('cleanProfile: DNS and sniffer', () => {
  it('leaves DNS alone when the app does not control it', async () => {
    const dns = { enable: false, nameserver: [] }

    assert.deepEqual((await clean({ dns }, false)).dns, dns)
  })

  it('drops DNS settings unless DNS is enabled', async () => {
    assert.equal('dns' in (await clean({ dns: { enable: false } })), false)
    assert.equal('dns' in (await clean({})), false)
  })

  it('strips empty lists, empty policies and a pointless respect-rules', async () => {
    const result = await clean({
      dns: {
        enable: true,
        'fake-ip-range': [],
        'fake-ip-range6': [],
        'fake-ip-filter': [],
        'proxy-server-nameserver': [],
        'direct-nameserver': [],
        nameserver: [],
        'respect-rules': true,
        'nameserver-policy': {},
        'proxy-server-nameserver-policy': {},
        ipv6: false
      }
    })

    assert.deepEqual(result.dns, { enable: true, ipv6: false })
  })

  it('keeps respect-rules while a proxy server nameserver backs it', async () => {
    const result = await clean({
      dns: {
        enable: true,
        'respect-rules': true,
        'proxy-server-nameserver': ['223.5.5.5'],
        nameserver: ['8.8.8.8'],
        'nameserver-policy': { 'geosite:cn': '223.5.5.5' },
        'proxy-server-nameserver-policy': { 'geosite:cn': '223.5.5.5' }
      }
    })

    assert.deepEqual(result.dns, {
      enable: true,
      'respect-rules': true,
      'proxy-server-nameserver': ['223.5.5.5'],
      nameserver: ['8.8.8.8'],
      'nameserver-policy': { 'geosite:cn': '223.5.5.5' },
      'proxy-server-nameserver-policy': { 'geosite:cn': '223.5.5.5' }
    })
  })

  it('drops respect-rules when no proxy server nameserver is configured at all', async () => {
    const result = await clean({
      dns: { enable: true, 'respect-rules': true, nameserver: ['8.8.8.8'] }
    })

    assert.deepEqual(result.dns, { enable: true, nameserver: ['8.8.8.8'] })
  })

  it('drops respect-rules when it is switched off', async () => {
    const result = await clean({
      dns: { enable: true, 'respect-rules': false, 'proxy-server-nameserver': ['223.5.5.5'] }
    })

    assert.equal('respect-rules' in (result.dns as Fields), false)
  })

  it('treats the sniffer like DNS: only an enabled one is kept, and only when controlled', async () => {
    assert.equal('sniffer' in (await clean({ sniffer: { enable: false } })), false)
    assert.deepEqual((await clean({ sniffer: { enable: true } })).sniffer, { enable: true })
    assert.deepEqual((await clean({ sniffer: { enable: false } }, true, false)).sniffer, {
      enable: false
    })
  })
})
