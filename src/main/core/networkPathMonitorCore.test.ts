import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildNetworkPathFingerprint,
  detectNetworkPathChange,
} from './networkPathMonitorCore'
import type { NetworkInterfaceInfo } from 'os'

function iface(address: string): NetworkInterfaceInfo[] {
  return [
    {
      address,
      family: 'IPv4',
      internal: false,
      netmask: '255.255.255.0',
      mac: '00:00:00:00:00:00',
      cidr: `${address}/24`,
    },
  ]
}

describe('networkPathMonitorCore', () => {
  it('builds stable fingerprint sorted by interface name', () => {
    const fp = buildNetworkPathFingerprint({
      en0: iface('192.168.1.10'),
      utun9: iface('10.8.0.2'),
    })
    assert.match(fp, /en0:IPv4=192\.168\.1\.10/)
    assert.match(fp, /utun9:IPv4=10\.8\.0\.2/)
  })

  it('detects path change when default interface address changes', () => {
    const before = { en0: iface('192.168.1.10') }
    const after = { en0: iface('192.168.1.99') }
    const change = detectNetworkPathChange(before, after)
    assert.equal(change.changed, true)
    assert.notEqual(change.beforeFingerprint, change.afterFingerprint)
  })

  it('ignores internal-only interfaces', () => {
    const fp = buildNetworkPathFingerprint({
      lo0: [
        {
          address: '127.0.0.1',
          family: 'IPv4',
          internal: true,
          netmask: '255.0.0.0',
          mac: '00:00:00:00:00:00',
          cidr: '127.0.0.1/8',
        },
      ],
    })
    assert.equal(fp, 'none')
  })
})
