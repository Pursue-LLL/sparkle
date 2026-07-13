import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectVpsServerIps,
  ensureVpsDirectBypass,
  isPublicIpv4
} from './vpsDirectBypass'

describe('vpsDirectBypass', () => {
  it('detects public IPv4', () => {
    assert.equal(isPublicIpv4('141.164.43.229'), true)
    assert.equal(isPublicIpv4('10.0.0.1'), false)
    assert.equal(isPublicIpv4('192.168.1.1'), false)
  })

  it('collects VPS server IPs from leaf proxies', async () => {
    const ips = await collectVpsServerIps([
      { name: 'KR-VPS-Reality', server: '141.164.43.229', type: 'vless' },
      { name: 'JP-VPS-HY2', server: '45.76.104.78', type: 'hysteria2' },
      { name: '🇸🇬新加坡-01 S 1.0x', server: 'productandservice.infralinkplus.com', type: 'ss' }
    ])
    assert.deepEqual(ips, ['141.164.43.229', '45.76.104.78'])
  })

  it('injects DIRECT rules and TUN/sniffer exclusions', async () => {
    const profile = {
      tun: { enable: true, 'route-exclude-address': ['10.0.0.0/8'] },
      sniffer: { enable: true, 'skip-dst-address': ['91.108.4.0/22'] },
      rules: ['MATCH,PROXY']
    } as unknown as MihomoConfig

    await ensureVpsDirectBypass(profile, [
      { name: 'KR-VPS-Reality', server: '141.164.43.229', type: 'vless' },
      { name: 'JP-VPS-TUIC', server: '45.76.104.78', type: 'tuic' }
    ])

    const rules = profile.rules as string[] | undefined
    assert.equal(rules?.[0], 'IP-CIDR,141.164.43.229/32,DIRECT,no-resolve')
    assert.equal(rules?.[1], 'IP-CIDR,45.76.104.78/32,DIRECT,no-resolve')
    assert.equal(rules?.[2], 'MATCH,PROXY')
    assert.deepEqual((profile.tun as MihomoTunConfig)['route-exclude-address'], [
      '141.164.43.229/32',
      '45.76.104.78/32',
      '10.0.0.0/8'
    ])
    assert.deepEqual((profile.sniffer as MihomoSnifferConfig)['skip-dst-address'], [
      '141.164.43.229/32',
      '45.76.104.78/32',
      '91.108.4.0/22'
    ])
  })

  it('skips non-VPS names and private IPs', async () => {
    const profile = { rules: ['MATCH,PROXY'] } as unknown as MihomoConfig
    await ensureVpsDirectBypass(profile, [
      { name: 'KR-自建', server: '141.164.43.229', type: 'ss' },
      { name: 'KR-VPS-LAN', server: '10.0.0.1', type: 'vless' }
    ])
    assert.deepEqual(profile.rules, ['MATCH,PROXY'])
  })

  it('does not duplicate existing DIRECT rules', async () => {
    const profile = {
      rules: ['IP-CIDR,141.164.43.229/32,DIRECT,no-resolve', 'MATCH,PROXY']
    } as unknown as MihomoConfig
    await ensureVpsDirectBypass(profile, [
      { name: 'KR-VPS-Reality', server: '141.164.43.229', type: 'vless' }
    ])
    assert.equal(profile.rules?.length, 2)
  })

  it('only adds rules when TUN and sniffer are disabled', async () => {
    const profile = {
      tun: { enable: false },
      sniffer: { enable: false },
      rules: ['MATCH,PROXY']
    } as unknown as MihomoConfig
    await ensureVpsDirectBypass(profile, [
      { name: 'KR-VPS-Reality', server: '141.164.43.229', type: 'vless' }
    ])
    const rules = profile.rules as string[] | undefined
    assert.equal(rules?.[0], 'IP-CIDR,141.164.43.229/32,DIRECT,no-resolve')
    assert.equal((profile.tun as MihomoTunConfig)['route-exclude-address'], undefined)
  })
})
