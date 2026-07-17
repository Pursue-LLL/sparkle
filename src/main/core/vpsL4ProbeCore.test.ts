import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildVpsL4ProbeResult,
  buildVpsSshArgs,
  detectFakeIpMisroute,
  isFakeIpHost,
  isUnresolvedSshHostName,
  parseSshGOutput,
  parseVpsL4CurlOutput,
  resolveVpsServerIpByRegion,
  resolveVpsSshTarget
} from './vpsL4ProbeCore'

describe('vpsL4ProbeCore', () => {
  it('parses api2 and marketplace curl lines', () => {
    const parsed = parseVpsL4CurlOutput(
      'api2 0.595200 200\nmarketplace 0.249000 200\n'
    )
    assert.equal(parsed.api2?.httpCode, 200)
    assert.equal(parsed.marketplace?.httpCode, 200)
    assert.ok((parsed.api2?.timeTotalSec ?? 0) > 0.5)
  })

  it('builds ok result when both curls succeed', () => {
    const result = buildVpsL4ProbeResult(
      'kr-vps',
      'KR-VPS',
      'api2 0.621000 200\nmarketplace 0.249000 200\n',
      '',
      {
        sshHost: 'kr-vps',
        hostName: '203.0.113.10',
        port: 22,
        identityFiles: [],
        resolvedVia: 'leaf_proxy_fallback'
      }
    )
    assert.equal(result.api2Ok, true)
    assert.equal(result.marketplaceOk, true)
    assert.equal(result.api2LatencyMs, 621)
    assert.equal(result.authoritative, true)
    assert.equal(result.probeAttribution, 'healthy')
    assert.equal(result.sshConnectHost, '203.0.113.10')
  })

  it('marks failure when api2 line missing', () => {
    const result = buildVpsL4ProbeResult('jp-vps', 'JP-VPS', 'marketplace 0.200000 200\n', '')
    assert.equal(result.api2Ok, false)
    assert.equal(result.authoritative, true)
    assert.equal(result.probeAttribution, undefined)
    assert.match(result.errorDetail ?? '', /missing api2/)
  })

  it('parses ssh -G output', () => {
    const parsed = parseSshGOutput(
      'hostname kr-vps\nport 2222\nuser alice\nidentityfile ~/.ssh/id_ed25519\n'
    )
    assert.equal(parsed.hostName, 'kr-vps')
    assert.equal(parsed.port, 2222)
    assert.equal(parsed.user, 'alice')
    assert.deepEqual(parsed.identityFiles, ['~/.ssh/id_ed25519'])
  })

  it('detects unresolved ssh hostname and fake-ip hosts', () => {
    assert.equal(isUnresolvedSshHostName('kr-vps', 'kr-vps'), true)
    assert.equal(isUnresolvedSshHostName('203.0.113.10', 'kr-vps'), false)
    assert.equal(isFakeIpHost('198.18.2.148'), true)
    assert.equal(isFakeIpHost('203.0.113.10'), false)
  })

  it('resolves leaf proxy fallback by region', () => {
    const leafProxies = [
      { name: 'KR-VPS-HY2', server: '203.0.113.10', type: 'hysteria2' },
      { name: 'JP-VPS-HY2', server: '198.51.100.10', type: 'hysteria2' }
    ]
    assert.equal(resolveVpsServerIpByRegion('KR-VPS', leafProxies), '203.0.113.10')
    assert.equal(resolveVpsServerIpByRegion('JP-VPS', leafProxies), '198.51.100.10')
  })

  it('falls back to leaf proxy IP when ssh -G hostname is alias', () => {
    const target = resolveVpsSshTarget(
      'kr-vps',
      'KR-VPS',
      { hostName: 'kr-vps', port: 22, identityFiles: [] },
      [{ name: 'KR-VPS-HY2', server: '203.0.113.10', type: 'hysteria2' }]
    )
    assert.equal(target?.hostName, '203.0.113.10')
    assert.equal(target?.resolvedVia, 'leaf_proxy_fallback')
  })

  it('builds ssh args with ProxyCommand=none and explicit HostName', () => {
    const args = buildVpsSshArgs(
      {
        sshHost: 'jp-vps',
        hostName: '198.51.100.10',
        port: 22,
        user: 'root',
        identityFiles: ['~/.ssh/id_ed25519'],
        resolvedVia: 'leaf_proxy_fallback'
      },
      'echo ok'
    )
    assert.deepEqual(args, [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ProxyCommand=none',
      '-o',
      'HostName=198.51.100.10',
      '-p',
      '22',
      '-l',
      'root',
      '-i',
      '~/.ssh/id_ed25519',
      'jp-vps',
      'echo ok'
    ])
  })

  it('detects fake-ip misroute in ssh errors', () => {
    assert.equal(
      detectFakeIpMisroute('Connection closed by 198.18.2.148 port 22'),
      true
    )
    assert.equal(detectFakeIpMisroute('Connection timed out'), false)
  })
})
