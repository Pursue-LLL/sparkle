import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cleanProfile, dedupeProxyGroupProviderUse } from './runtimeConfigSanitize'

type Fields = Record<string, unknown>

async function clean(fields: Fields, controlDns = true, controlSniff = true): Promise<Fields> {
  const profile = structuredClone(fields) as unknown as MihomoConfig
  await cleanProfile(profile, controlDns, controlSniff)
  return profile as unknown as Fields
}

async function withPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    return await run()
  } finally {
    if (original) {
      Object.defineProperty(process, 'platform', original)
    }
  }
}

describe('cleanProfile: log level', () => {
  it('keeps info and debug and forces anything else to info', async () => {
    assert.equal((await clean({ 'log-level': 'debug' }))['log-level'], 'debug')
    assert.equal((await clean({ 'log-level': 'info' }))['log-level'], 'info')
    for (const level of ['warning', 'error', 'silent', undefined]) {
      assert.equal((await clean({ 'log-level': level }))['log-level'], 'info')
    }
  })
})

describe('cleanProfile: scalar options', () => {
  it('drops ipv6 unless it is explicitly off', async () => {
    assert.equal('ipv6' in (await clean({ ipv6: true })), false)
    assert.equal('ipv6' in (await clean({})), false)
    assert.equal((await clean({ ipv6: false })).ipv6, false)
  })

  it('drops switched-off boolean options and keeps the enabled ones', async () => {
    const result = await clean({
      'unified-delay': true,
      'tcp-concurrent': false,
      'geodata-mode': false,
      'geo-auto-update': true,
      'disable-keep-alive': false
    })
    assert.equal(result['unified-delay'], true)
    assert.equal(result['geo-auto-update'], true)
    for (const key of ['tcp-concurrent', 'geodata-mode', 'disable-keep-alive']) {
      assert.equal(key in result, false, key)
    }
  })

  it('keeps only the profile flags that are on', async () => {
    assert.equal(
      'profile' in (await clean({ profile: { 'store-selected': false, 'store-fake-ip': false } })),
      false
    )
    assert.deepEqual(
      (await clean({ profile: { 'store-selected': true, 'store-fake-ip': false } })).profile,
      { 'store-selected': true }
    )
    assert.deepEqual(
      (await clean({ profile: { 'store-selected': false, 'store-fake-ip': true } })).profile,
      { 'store-fake-ip': true }
    )
  })

  it('fills the keep-alive defaults unless keep-alive is disabled', async () => {
    const defaults = await clean({})
    assert.equal(defaults['keep-alive-idle'], 3600)
    assert.equal(defaults['keep-alive-interval'], 60)

    const zeroed = await clean({ 'keep-alive-idle': 0, 'keep-alive-interval': 0 })
    assert.equal(zeroed['keep-alive-idle'], 3600)
    assert.equal(zeroed['keep-alive-interval'], 60)

    const custom = await clean({ 'keep-alive-idle': 120, 'keep-alive-interval': 15 })
    assert.equal(custom['keep-alive-idle'], 120)
    assert.equal(custom['keep-alive-interval'], 15)

    const disabled = await clean({ 'disable-keep-alive': true })
    assert.equal('keep-alive-idle' in disabled, false)
    assert.equal('keep-alive-interval' in disabled, false)
  })

  it('drops zero ports and keeps real ones', async () => {
    const result = await clean({ port: 0, 'socks-port': 0, 'mixed-port': 7890, 'redir-port': 0 })

    assert.deepEqual(
      [result.port, result['socks-port'], result['redir-port'], result['mixed-port']],
      [undefined, undefined, undefined, 7890]
    )
  })

  it('drops default and empty string options', async () => {
    const result = await clean({
      mode: 'rule',
      'interface-name': '',
      secret: '',
      'global-client-fingerprint': '',
      'external-controller': '127.0.0.1:9090'
    })

    for (const key of ['mode', 'interface-name', 'secret', 'global-client-fingerprint']) {
      assert.equal(key in result, false, key)
    }
    assert.equal(result['external-controller'], '127.0.0.1:9090')
    assert.equal((await clean({ mode: 'global' })).mode, 'global')
  })

  it('removes the controller UI options together with an empty controller address', async () => {
    const result = await clean({
      'external-controller': '',
      'external-ui': 'ui',
      'external-ui-url': 'https://example.test/ui.zip',
      'external-controller-cors': { 'allow-origins': ['*'] }
    })

    for (const key of [
      'external-controller',
      'external-ui',
      'external-ui-url',
      'external-controller-cors'
    ]) {
      assert.equal(key in result, false, key)
    }
  })

  it('removes only the UI options when just the UI folder is empty', async () => {
    const result = await clean({
      'external-controller': '127.0.0.1:9090',
      'external-ui': '',
      'external-ui-url': 'https://example.test/ui.zip',
      'external-controller-cors': { 'allow-origins': ['*'] }
    })

    assert.equal(result['external-controller'], '127.0.0.1:9090')
    assert.deepEqual(result['external-controller-cors'], { 'allow-origins': ['*'] })
    assert.equal('external-ui' in result, false)
    assert.equal('external-ui-url' in result, false)
  })

  it('drops empty authentication together with its skip prefixes', async () => {
    const empty = await clean({ authentication: [], 'skip-auth-prefixes': ['127.0.0.1/8'] })
    assert.equal('authentication' in empty, false)
    assert.equal('skip-auth-prefixes' in empty, false)

    const set = await clean({ authentication: ['user:pass'], 'skip-auth-prefixes': ['10.0.0.0/8'] })
    assert.deepEqual(set.authentication, ['user:pass'])
    assert.deepEqual(set['skip-auth-prefixes'], ['10.0.0.0/8'])
  })
})

describe('cleanProfile: LAN access', () => {
  it('keeps allow-lan off but forgets its address lists', async () => {
    const result = await clean({
      'allow-lan': false,
      'lan-allowed-ips': ['192.168.0.0/16'],
      'lan-disallowed-ips': ['192.168.1.1/32']
    })

    assert.equal(result['allow-lan'], false)
    assert.equal('lan-allowed-ips' in result, false)
    assert.equal('lan-disallowed-ips' in result, false)
  })

  it('forgets everything about the LAN when allow-lan is unset', async () => {
    const result = await clean({ 'lan-allowed-ips': ['192.168.0.0/16'] })

    assert.equal('allow-lan' in result, false)
    assert.equal('lan-allowed-ips' in result, false)
  })

  it('adds loopback to a restricted allow list that lacks it', async () => {
    const restricted = await clean({ 'allow-lan': true, 'lan-allowed-ips': ['192.168.0.0/16'] })
    assert.deepEqual(restricted['lan-allowed-ips'], ['192.168.0.0/16', '127.0.0.1/8'])

    const withLoopback = await clean({
      'allow-lan': true,
      'lan-allowed-ips': ['127.0.0.1/32', '10.0.0.0/8']
    })
    assert.deepEqual(withLoopback['lan-allowed-ips'], ['127.0.0.1/32', '10.0.0.0/8'])
  })

  it('drops empty allow and deny lists', async () => {
    const result = await clean({
      'allow-lan': true,
      'lan-allowed-ips': [],
      'lan-disallowed-ips': []
    })

    assert.equal(result['allow-lan'], true)
    assert.equal('lan-allowed-ips' in result, false)
    assert.equal('lan-disallowed-ips' in result, false)
  })
})

describe('cleanProfile: TUN', () => {
  it('drops TUN settings unless TUN is enabled', async () => {
    assert.equal('tun' in (await clean({ tun: { enable: false, stack: 'mixed' } })), false)
    assert.equal('tun' in (await clean({})), false)
  })

  it('strips defaults and empty values from an enabled TUN', async () => {
    const result = await withPlatform('linux', () =>
      clean({
        tun: {
          enable: true,
          stack: 'mixed',
          'auto-route': true,
          'auto-detect-interface': true,
          'auto-redirect': false,
          'strict-route': false,
          'disable-icmp-forwarding': false,
          device: '',
          'dns-hijack': [],
          'route-exclude-address': []
        }
      })
    )

    assert.deepEqual(result.tun, { enable: true, stack: 'mixed' })
  })

  it('keeps the TUN options that deviate from the defaults', async () => {
    const result = await withPlatform('linux', () =>
      clean({
        tun: {
          enable: true,
          'auto-route': false,
          'auto-detect-interface': false,
          'strict-route': true,
          device: 'mihomo0',
          'dns-hijack': ['any:53'],
          'route-exclude-address': ['10.0.0.0/8']
        }
      })
    )

    assert.deepEqual(result.tun, {
      enable: true,
      'auto-route': false,
      'auto-detect-interface': false,
      'strict-route': true,
      device: 'mihomo0',
      'dns-hijack': ['any:53'],
      'route-exclude-address': ['10.0.0.0/8']
    })
  })

  it('only accepts utun device names on macOS', async () => {
    const dropped = await withPlatform('darwin', () =>
      clean({ tun: { enable: true, device: 'mihomo0' } })
    )
    assert.equal('device' in (dropped.tun as Fields), false)

    const kept = await withPlatform('darwin', () =>
      clean({ tun: { enable: true, device: 'utun9' } })
    )
    assert.equal((kept.tun as Fields).device, 'utun9')
  })
})

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
        'nameserver-policy': { 'geosite:cn': '223.5.5.5' }
      }
    })

    assert.deepEqual(result.dns, {
      enable: true,
      'respect-rules': true,
      'proxy-server-nameserver': ['223.5.5.5'],
      nameserver: ['8.8.8.8'],
      'nameserver-policy': { 'geosite:cn': '223.5.5.5' }
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

describe('cleanProfile: proxies and providers', () => {
  it('drops empty proxy lists, rule lists and provider tables', async () => {
    const result = await clean({
      proxies: [],
      'proxy-groups': [],
      rules: [],
      'proxy-providers': {},
      'rule-providers': null
    })

    for (const key of ['proxies', 'proxy-groups', 'rules', 'proxy-providers', 'rule-providers']) {
      assert.equal(key in result, false, key)
    }
  })

  it('keeps populated proxies, groups, rules and providers', async () => {
    const fields = {
      proxies: [{ name: 'a', type: 'ss' }],
      'proxy-groups': [{ name: 'g', type: 'select', proxies: ['a'] }],
      rules: ['MATCH,g'],
      'proxy-providers': { p: { type: 'file' } },
      'rule-providers': { r: { type: 'http' } }
    }
    const result = await clean(fields)
    for (const [key, value] of Object.entries(fields)) {
      assert.deepEqual(result[key], value, key)
    }
  })
})

describe('dedupeProxyGroupProviderUse', () => {
  it('collapses repeated provider references in order of first use', () => {
    const profile = {
      'proxy-groups': [
        { name: 'a', type: 'select', use: ['p1', 'p2', 'p1', 'p3', 'p2'] },
        { name: 'b', type: 'select', proxies: ['x'] },
        { name: 'c', type: 'select', use: ['p1'] }
      ]
    } as unknown as MihomoConfig

    dedupeProxyGroupProviderUse(profile)

    assert.deepEqual(
      (profile['proxy-groups'] as unknown as { use?: string[] }[]).map((group) => group.use),
      [['p1', 'p2', 'p3'], undefined, ['p1']]
    )
  })

  it('does nothing for a profile without proxy groups', () => {
    const profile = {} as unknown as MihomoConfig

    dedupeProxyGroupProviderUse(profile)

    assert.deepEqual(profile, {})
  })
})
