import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildProviderProxyLookup, resolveGroupMemberProxies } from './mihomoGroupMembersCore'

describe('mihomoGroupMembersCore', () => {
  it('buildProviderProxyLookup indexes provider leaf proxies by name', () => {
    const lookup = buildProviderProxyLookup({
      providers: {
        '199e64b94e8': {
          name: '199e64b94e8',
          type: 'file',
          expectedStatus: '204',
          vehicleType: 'File',
          proxies: [
            {
              name: 'KR-VPS-TUIC',
              type: 'Tuic',
              alive: true,
              history: [{ time: '2026-07-09T00:00:00+08:00', delay: 120 }],
              extra: {},
              id: 'kr-tuic',
              tfo: false,
              udp: true,
              xudp: false,
              mptcp: false,
              smux: false,
              uot: false,
              'dialer-proxy': '',
              interface: '',
              'routing-mark': 0
            }
          ]
        }
      }
    })

    assert.equal(lookup.size, 1)
    assert.equal(lookup.get('KR-VPS-TUIC')?.type, 'Tuic')
  })

  it('resolveGroupMemberProxies prefers /proxies then provider lookup', () => {
    const proxiesDict = {
      'Sparkle-自动-新加坡': {
        name: 'Sparkle-自动-新加坡',
        type: 'URLTest',
        alive: true,
        all: ['SG-01'],
        extra: {},
        hidden: false,
        history: [],
        icon: '',
        interface: '',
        mptcp: false,
        now: 'SG-01',
        smux: false,
        tfo: false,
        udp: true,
        uot: false,
        xudp: false
      }
    } as Record<string, ControllerProxiesDetail | ControllerGroupDetail>

    const providerLookup = buildProviderProxyLookup({
      providers: {
        p1: {
          name: 'p1',
          type: 'file',
          expectedStatus: '204',
          vehicleType: 'File',
          proxies: [
            {
              name: 'KR-VPS-TUIC',
              type: 'Tuic',
              alive: true,
              history: [{ time: '2026-07-09T00:00:00+08:00', delay: 297 }],
              extra: {},
              id: 'kr-tuic',
              tfo: false,
              udp: true,
              xudp: false,
              mptcp: false,
              smux: false,
              uot: false,
              'dialer-proxy': '',
              interface: '',
              'routing-mark': 0
            }
          ]
        }
      }
    })

    const resolved = resolveGroupMemberProxies(
      ['Sparkle-自动-新加坡', 'KR-VPS-TUIC', 'MISSING-NODE'],
      proxiesDict,
      providerLookup
    )

    assert.equal(resolved.length, 3)
    assert.equal(resolved[0].name, 'Sparkle-自动-新加坡')
    assert.equal(resolved[1].name, 'KR-VPS-TUIC')
    assert.equal((resolved[1] as ControllerProxiesDetail).history[0]?.delay, 297)
    assert.equal(resolved[2].name, 'MISSING-NODE')
    assert.equal((resolved[2] as ControllerProxiesDetail).type, 'Unknown')
  })
})
