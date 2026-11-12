import assert from 'node:assert/strict'
import dns from 'node:dns'
import { afterEach, describe, it, mock } from 'node:test'
import {
  VPS_SSH_HOST_ALIASES,
  collectVpsServerIps,
  ensureVpsDirectBypass,
  isPublicIpv4
} from './vpsDirectBypass'

// 别名名单是配置，不是被测行为：用例只断言“名单里的每个别名都得到 DIRECT 规则”，别名换了测试不必跟着改。
const ALIAS_RULES = VPS_SSH_HOST_ALIASES.map((host) => `DOMAIN,${host},DIRECT,no-resolve`)
const directRule = (ip: string): string => `IP-CIDR,${ip}/32,DIRECT,no-resolve`

function profileOf(fields: Record<string, unknown>): MihomoConfig {
  return fields as unknown as MihomoConfig
}

afterEach(() => {
  mock.restoreAll()
  mock.timers.reset()
})

describe('isPublicIpv4', () => {
  it('accepts public addresses', () => {
    assert.equal(isPublicIpv4('203.0.113.10'), true)
    assert.equal(isPublicIpv4('172.15.0.1'), true)
    assert.equal(isPublicIpv4('198.17.0.1'), true)
  })

  it('rejects private, loopback, link-local, benchmark, reserved and malformed addresses', () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.1.1',
      '198.18.0.1',
      '198.19.255.255',
      '0.1.2.3',
      '224.0.0.1',
      '255.255.255.255',
      '256.1.1.1',
      '1.2.3',
      'example.com'
    ]) {
      assert.equal(isPublicIpv4(ip), false, ip)
    }
  })
})

describe('collectVpsServerIps', () => {
  it('collects public IPs from VPS leaf proxies, sorted and without duplicates', async () => {
    const ips = await collectVpsServerIps([
      { name: 'KR-VPS-Reality', server: '203.0.113.10', type: 'vless' },
      { name: 'KR-VPS-HY2', server: '198.51.100.10', type: 'hysteria2' },
      { name: 'KR-VPS-TUIC', server: '198.51.100.10', type: 'tuic' },
      { name: '🇸🇬新加坡-01 S 1.0x', server: '203.0.113.99', type: 'ss' }
    ])

    assert.deepEqual(ips, ['198.51.100.10', '203.0.113.10'])
  })

  it('recognises a VPS leaf by its name or by an advanced protocol type, ignoring case', async () => {
    const ips = await collectVpsServerIps([
      { name: 'my-vps', server: '203.0.113.1', type: 'ss' },
      { name: 'plain', server: '203.0.113.2', type: 'VLESS' },
      { name: 'plain', server: '203.0.113.3', type: 'Hysteria2' },
      { name: 'plain', server: '203.0.113.4', type: 'ss' }
    ])

    assert.deepEqual(ips, ['203.0.113.1', '203.0.113.2', '203.0.113.3'])
  })

  it('skips private addresses and malformed entries', async () => {
    const ips = await collectVpsServerIps([
      null,
      'not-an-object',
      { name: 'VPS-LAN', server: '10.0.0.1', type: 'vless' },
      { name: 'VPS-no-server', type: 'vless' },
      { name: 'VPS-bad-server', server: 42, type: 'vless' },
      { name: 'VPS-ok', server: '203.0.113.5', type: 'vless' },
      { server: '203.0.113.6' },
      { name: 7, type: 8, server: '203.0.113.7' }
    ])

    assert.deepEqual(ips, ['203.0.113.5'])
  })

  it('resolves host names and keeps only public results', async () => {
    mock.method(dns.promises, 'resolve4', async (host: string) =>
      host === 'vps.example.test' ? ['10.1.1.1', '203.0.113.20', '203.0.113.21'] : []
    )

    const ips = await collectVpsServerIps([
      { name: 'JP-VPS', server: 'vps.example.test', type: 'vless' },
      { name: 'JP-VPS-2', server: 'unknown.example.test', type: 'vless' }
    ])

    assert.deepEqual(ips, ['203.0.113.20', '203.0.113.21'])
  })

  it('treats a failing lookup as no addresses without affecting the others', async () => {
    mock.method(dns.promises, 'resolve4', async (host: string) => {
      if (host === 'broken.example.test') {
        throw new Error('ENOTFOUND')
      }
      return ['203.0.113.30']
    })

    const ips = await collectVpsServerIps([
      { name: 'VPS-broken', server: 'broken.example.test', type: 'vless' },
      { name: 'VPS-fine', server: 'fine.example.test', type: 'vless' }
    ])

    assert.deepEqual(ips, ['203.0.113.30'])
  })

  it('leaves no pending timeout behind once the lookup has answered', async () => {
    mock.method(dns.promises, 'resolve4', async () => ['203.0.113.50'])
    const pendingTimers = (): number =>
      process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length
    const before = pendingTimers()

    await collectVpsServerIps([{ name: 'VPS-fast', server: 'fast.example.test', type: 'vless' }])

    assert.equal(pendingTimers(), before)
  })

  it('gives up on a lookup that never answers', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    mock.method(
      dns.promises,
      'resolve4',
      () =>
        new Promise<string[]>(() => {
          // 永不应答，模拟解析挂死
        })
    )

    const pending = collectVpsServerIps([
      { name: 'VPS-hang', server: 'hang.example.test', type: 'vless' },
      { name: 'VPS-ip', server: '203.0.113.40', type: 'vless' }
    ])
    // 先让第一个 await 注册完超时定时器，再推进时间
    await Promise.resolve()
    mock.timers.tick(3000)

    assert.deepEqual(await pending, ['203.0.113.40'])
  })
})

describe('ensureVpsDirectBypass', () => {
  it('puts alias and IP DIRECT rules first and excludes the IPs from TUN and sniffer', async () => {
    const profile = profileOf({
      tun: { enable: true, 'route-exclude-address': ['10.0.0.0/8'] },
      sniffer: { enable: true, 'skip-dst-address': ['91.108.4.0/22'] },
      rules: ['MATCH,PROXY']
    })

    await ensureVpsDirectBypass(profile, [
      { name: 'KR-VPS-Reality', server: '203.0.113.10', type: 'vless' },
      { name: 'KR-VPS-TUIC', server: '198.51.100.10', type: 'tuic' }
    ])

    assert.deepEqual(profile.rules, [
      ...ALIAS_RULES,
      directRule('198.51.100.10'),
      directRule('203.0.113.10'),
      'MATCH,PROXY'
    ])
    assert.deepEqual(profile.tun?.['route-exclude-address'], [
      '198.51.100.10/32',
      '203.0.113.10/32',
      '10.0.0.0/8'
    ])
    assert.deepEqual(profile.sniffer?.['skip-dst-address'], [
      '198.51.100.10/32',
      '203.0.113.10/32',
      '91.108.4.0/22'
    ])
  })

  it('still adds the SSH alias rules for non-VPS or private servers', async () => {
    const profile = profileOf({ rules: ['MATCH,PROXY'] })

    await ensureVpsDirectBypass(profile, [
      { name: 'KR-自建', server: '203.0.113.10', type: 'ss' },
      { name: 'KR-VPS-LAN', server: '10.0.0.1', type: 'vless' }
    ])

    assert.deepEqual(profile.rules, [...ALIAS_RULES, 'MATCH,PROXY'])
  })

  it('adds the alias rules even when there are no leaf proxies or no rules yet', async () => {
    const withRules = profileOf({ rules: ['MATCH,PROXY'] })
    await ensureVpsDirectBypass(withRules, [])
    assert.deepEqual(withRules.rules, [...ALIAS_RULES, 'MATCH,PROXY'])

    const withoutRules = profileOf({})
    await ensureVpsDirectBypass(withoutRules, [])
    assert.deepEqual(withoutRules.rules, ALIAS_RULES)
  })

  it('does not duplicate rules that already exist, whatever their spelling', async () => {
    const [alias] = VPS_SSH_HOST_ALIASES
    const profile = profileOf({
      rules: [
        `  # comment`,
        `DOMAIN, ${alias.toUpperCase()} ,DIRECT`,
        directRule('203.0.113.10'),
        'IP-CIDR,198.51.100.10/24,DIRECT,no-resolve',
        'MATCH,PROXY'
      ]
    })
    const before = [...(profile.rules as string[])]

    await ensureVpsDirectBypass(profile, [
      { name: 'KR-VPS-Reality', server: '203.0.113.10', type: 'vless' },
      { name: 'KR-VPS-HY2', server: '198.51.100.10', type: 'hysteria2' }
    ])

    assert.deepEqual(profile.rules, before)
  })

  it('ignores commented-out and non-matching rules when checking for duplicates', async () => {
    const [alias] = VPS_SSH_HOST_ALIASES
    const profile = profileOf({
      rules: [
        `# DOMAIN,${alias},DIRECT`,
        `DOMAIN-SUFFIX,${alias},DIRECT`,
        '',
        '# IP-CIDR,203.0.113.10/32,DIRECT',
        'IP-CIDR,203.0.113.11/32,DIRECT',
        'MATCH,PROXY'
      ]
    })

    await ensureVpsDirectBypass(profile, [
      { name: 'KR-VPS-Reality', server: '203.0.113.10', type: 'vless' }
    ])

    assert.deepEqual((profile.rules as string[]).slice(0, ALIAS_RULES.length + 1), [
      ...ALIAS_RULES,
      directRule('203.0.113.10')
    ])
    assert.equal((profile.rules as string[]).length, 6 + ALIAS_RULES.length + 1)
  })

  it('does not repeat addresses that TUN and sniffer already exclude', async () => {
    const profile = profileOf({
      tun: { enable: true, 'route-exclude-address': ['203.0.113.10/32', '10.0.0.0/8'] },
      sniffer: { enable: true, 'skip-dst-address': ['203.0.113.10/32'] },
      rules: ['MATCH,PROXY']
    })

    await ensureVpsDirectBypass(profile, [
      { name: 'KR-VPS-Reality', server: '203.0.113.10', type: 'vless' }
    ])

    assert.deepEqual(profile.tun?.['route-exclude-address'], ['203.0.113.10/32', '10.0.0.0/8'])
    assert.deepEqual(profile.sniffer?.['skip-dst-address'], ['203.0.113.10/32'])
  })

  it('creates the exclusion lists when TUN and sniffer have none', async () => {
    const profile = profileOf({
      tun: { enable: true },
      sniffer: { enable: true },
      rules: ['MATCH,PROXY']
    })

    await ensureVpsDirectBypass(profile, [
      { name: 'KR-VPS-Reality', server: '203.0.113.10', type: 'vless' }
    ])

    assert.deepEqual(profile.tun?.['route-exclude-address'], ['203.0.113.10/32'])
    assert.deepEqual(profile.sniffer?.['skip-dst-address'], ['203.0.113.10/32'])
  })

  it('leaves TUN and sniffer alone when they are disabled or absent', async () => {
    const disabled = profileOf({
      tun: { enable: false },
      sniffer: { enable: false },
      rules: ['MATCH,PROXY']
    })
    await ensureVpsDirectBypass(disabled, [
      { name: 'KR-VPS-Reality', server: '203.0.113.10', type: 'vless' }
    ])
    assert.deepEqual(disabled.rules, [...ALIAS_RULES, directRule('203.0.113.10'), 'MATCH,PROXY'])
    assert.equal(disabled.tun?.['route-exclude-address'], undefined)
    assert.equal(disabled.sniffer?.['skip-dst-address'], undefined)

    const absent = profileOf({ rules: ['MATCH,PROXY'] })
    await ensureVpsDirectBypass(absent, [
      { name: 'KR-VPS-Reality', server: '203.0.113.10', type: 'vless' }
    ])
    assert.equal('tun' in absent, false)
    assert.equal('sniffer' in absent, false)
  })

  it('does not touch a profile that already has every rule and nothing new to add', async () => {
    const profile = profileOf({ rules: [...ALIAS_RULES, 'MATCH,PROXY'] })

    await ensureVpsDirectBypass(profile, [])

    assert.deepEqual(profile.rules, [...ALIAS_RULES, 'MATCH,PROXY'])
  })
})
