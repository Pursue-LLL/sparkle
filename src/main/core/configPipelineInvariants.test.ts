import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensureCnDirectBaseline } from './cnDirectBaseline'
import {
  migrateLegacyCursorDedicatedGroupReferences,
  rewriteBroadCursorDedicatedRules
} from './cursorDedicatedRuleRewrite'
import {
  AUTO_SELECT_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES
} from './cursorProxyGroup'
import { rewriteMissingRuleProxyGroupTargets } from './profileGroupNormalize'
import { parseRule } from './ruleSyntax'
import { fingerprintRuntimeConfig } from './runtimeConfigSyncCore'
import { clean, type Fields } from './runtimeConfigSanitizeHarness'
import { forSeeds, forSeedsAsync, type Random } from './seededProperty'

const RUNS = 400
const POLICIES = ['DIRECT', '🚀 节点选择', AUTO_SELECT_GROUP_NAME, CURSOR_DEDICATED_GROUP_NAME]
const HOSTS = ['example.com', 'cursor.sh', 'google.com', 'sh', 'api.cursorapi.com']

function randomRule(random: Random, policies: readonly string[] = POLICIES): string {
  const policy = random.pick(policies)
  const host = random.pick(HOSTS)
  return random.pick([
    `DOMAIN-SUFFIX,${host},${policy}`,
    `DOMAIN,${host},${policy}`,
    `DOMAIN-KEYWORD,${host},${policy}`,
    `GEOIP,${random.pick(['CN', 'cn', 'US'])},${policy}`,
    `geosite , ${random.pick(['CN', 'google'])} ,${policy}`,
    `RULE-SET,${host},${policy}`,
    `IP-CIDR,10.0.0.0/8,${policy},no-resolve`,
    `PROCESS-NAME,Cursor,${policy}`,
    `  MATCH,${policy}`,
    'MATCH ,DIRECT',
    '# GEOIP,CN,DIRECT',
    ''
  ])
}

function randomRules(random: Random, policies?: readonly string[]): string[] {
  return Array.from({ length: random.int(0, 12) }, () => randomRule(random, policies))
}

const fieldsOf = (rule: string): string[] => rule.split(',').map((field) => field.trim())

function profileOf(rules: string[] | undefined): MihomoConfig {
  return { rules } as unknown as MihomoConfig
}

function rulesOf(profile: MihomoConfig): string[] {
  return profile.rules as unknown as string[]
}

describe('cn direct baseline (random rule lists)', () => {
  const BASELINE = ['GEOSITE,CN,DIRECT', 'GEOIP,CN,DIRECT']

  /** 订阅已能分流国内流量：有 GEOIP/GEOSITE 的 CN 规则，或交给规则集。 */
  function routesCnTraffic(rule: string): boolean {
    const [type, payload] = fieldsOf(rule).map((field) => field.toUpperCase())
    return type === 'RULE-SET' || ((type === 'GEOIP' || type === 'GEOSITE') && payload === 'CN')
  }

  const isMatch = (rule: string): boolean => fieldsOf(rule)[0].toUpperCase() === 'MATCH'

  it('adds the baseline just in front of the last MATCH, only when CN traffic is not routed', () => {
    let injectedRuns = 0
    forSeeds(RUNS, (random) => {
      const original = random.chance(0.1) ? undefined : randomRules(random)
      const profile = profileOf(original && [...original])

      const injected = ensureCnDirectBaseline(profile)

      const before = original ?? []
      assert.equal(injected, !before.some(routesCnTraffic))
      if (!injected) {
        assert.deepEqual(profile.rules, original)
        return
      }
      injectedRuns += 1
      const after = rulesOf(profile)
      const at = before.findLastIndex(isMatch)
      const expectedAt = at === -1 ? before.length : at
      assert.deepEqual(after.slice(expectedAt, expectedAt + 2), BASELINE)
      assert.deepEqual([...after.slice(0, expectedAt), ...after.slice(expectedAt + 2)], before)
      assert.equal(ensureCnDirectBaseline(profile), false, 'a second pass must change nothing')
      assert.equal(rulesOf(profile).length, before.length + 2)
    })
    assert.ok(injectedRuns > RUNS / 5, `the baseline is barely exercised (${injectedRuns}/${RUNS})`)
  })

  it('never edits the caller-owned rule array in place', () => {
    forSeeds(RUNS, (random) => {
      const original = randomRules(random)
      const frozen = Object.freeze([...original])

      ensureCnDirectBaseline(profileOf(frozen as string[]))

      assert.deepEqual(frozen, original)
    })
  })
})

describe('cursor rule rewriting (random rule lists)', () => {
  const POLICIES_WITH_LEGACY = [...POLICIES, ...LEGACY_CURSOR_DEDICATED_GROUP_NAMES]

  it('retargets only Cursor-group rules to auto select, keeps everything else, and is idempotent', () => {
    forSeeds(RUNS, (random) => {
      const original = randomRules(random)
      const profile = profileOf([...original])

      rewriteBroadCursorDedicatedRules(profile)
      const once = [...rulesOf(profile)]
      rewriteBroadCursorDedicatedRules(profile)

      assert.deepEqual(rulesOf(profile), once)
      assert.equal(once.length, original.length)
      for (const [index, rule] of once.entries()) {
        if (rule === original[index]) continue
        const before = fieldsOf(original[index])
        // 策略是 no-resolve 这类修饰符之前的最后一个字段，改写时修饰符原样保留。
        const policyAt = before.findLastIndex((field) => field !== 'no-resolve')
        assert.equal(before[policyAt], CURSOR_DEDICATED_GROUP_NAME)
        assert.deepEqual(fieldsOf(rule), before.with(policyAt, AUTO_SELECT_GROUP_NAME))
      }
    })
  })

  it('moves every legacy group name to the current one, reports it truthfully and settles in one pass', () => {
    forSeeds(RUNS, (random) => {
      const original = randomRules(random, POLICIES_WITH_LEGACY)
      const profile = profileOf([...original])
      const mentionsLegacy = (rule: string): boolean =>
        LEGACY_CURSOR_DEDICATED_GROUP_NAMES.some((legacy) => rule.includes(legacy))

      const migrated = migrateLegacyCursorDedicatedGroupReferences(profile)

      assert.equal(migrated, original.some(mentionsLegacy))
      assert.equal(rulesOf(profile).some(mentionsLegacy), false)
      assert.deepEqual(
        rulesOf(profile).filter((_, index) => !mentionsLegacy(original[index])),
        original.filter((rule) => !mentionsLegacy(rule))
      )
      assert.equal(migrateLegacyCursorDedicatedGroupReferences(profile), false)
    })
  })
})

describe('rule target repair (random rule lists)', () => {
  const MAIN_GROUP = '主代理'
  const KNOWN_OUTSIDE_PROFILE = ['DIRECT', 'REJECT']
  const TARGETS = [
    ...KNOWN_OUTSIDE_PROFILE,
    MAIN_GROUP,
    '备用',
    'SG-01',
    '🚀 节点选择',
    '不存在组',
    CURSOR_DEDICATED_GROUP_NAME
  ]

  it('leaves every rule pointing at something mihomo can load and touches only the ones that did not', () => {
    forSeeds(RUNS, (random) => {
      const groups = [
        { name: MAIN_GROUP, type: 'select' },
        { name: '备用', type: 'fallback' },
        ...(random.chance(0.5) ? [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'select' }] : [])
      ]
      const nodes = random.chance(0.5) ? [{ name: 'SG-01', type: 'ss' }] : undefined
      const known = new Set([
        ...KNOWN_OUTSIDE_PROFILE,
        ...groups.map((group) => group.name),
        ...(nodes ? ['SG-01'] : [])
      ])
      const original = randomRules(random, TARGETS)
      const profile = {
        proxies: nodes,
        'proxy-groups': groups,
        rules: [...original]
      } as unknown as MihomoConfig

      rewriteMissingRuleProxyGroupTargets(profile)

      const repaired = rulesOf(profile)
      assert.equal(repaired.length, original.length)
      original.forEach((rule, index) => {
        const before = parseRule(rule)
        const after = parseRule(repaired[index])
        if (!before || !after) {
          assert.equal(repaired[index], rule)
          return
        }
        assert.ok(known.has(after.policy), `${rule} -> ${repaired[index]}`)
        if (known.has(before.policy)) {
          assert.equal(repaired[index], rule)
        } else if (before.head[0].toUpperCase() === 'MATCH') {
          assert.equal(after.policy, MAIN_GROUP)
        }
      })

      rewriteMissingRuleProxyGroupTargets(profile)
      assert.deepEqual(rulesOf(profile), repaired)
    })
  })
})

describe('profile sanitising (random profiles)', () => {
  const SCALARS: Record<string, readonly unknown[]> = {
    'log-level': ['debug', 'info', 'warning', 'silent'],
    mode: ['rule', 'global', 'direct'],
    ipv6: [true, false],
    'unified-delay': [true, false],
    'tcp-concurrent': [true, false],
    'disable-keep-alive': [true, false],
    'keep-alive-idle': [0, 600],
    'keep-alive-interval': [0, 30],
    port: [0, 7890],
    'mixed-port': [0, 7897],
    'interface-name': ['', 'en0'],
    secret: ['', 'token'],
    'global-client-fingerprint': ['', 'chrome'],
    'external-controller': ['', '127.0.0.1:9090'],
    'external-ui': ['', 'ui'],
    'external-ui-url': ['', 'https://example.test/ui.zip'],
    'external-controller-cors': [{}, { 'allow-origins': ['*'] }],
    'allow-lan': [true, false],
    'lan-allowed-ips': [[], ['10.0.0.0/8'], ['127.0.0.1/32']],
    'lan-disallowed-ips': [[], ['10.0.0.1/32']],
    authentication: [[], ['user:pass']],
    'skip-auth-prefixes': [[], ['10.0.0.0/8']],
    profile: [{}, { 'store-selected': true }, { 'store-selected': false, 'store-fake-ip': true }],
    proxies: [[], [{ name: 'a', type: 'ss' }]],
    'proxy-groups': [[], [{ name: 'g', type: 'select', proxies: ['a'] }]],
    rules: [[], ['MATCH,g']],
    'proxy-providers': [{}, null, { p: { type: 'file' } }],
    'rule-providers': [{}, null, { r: { type: 'http' } }]
  }

  function someOf(random: Random, entries: Record<string, unknown>): Fields {
    return Object.fromEntries(Object.entries(entries).filter(() => random.chance(0.6)))
  }

  function randomProfile(random: Random): Fields {
    const scalars = Object.fromEntries(
      Object.entries(SCALARS).flatMap(([key, values]) =>
        random.chance(0.6) ? [[key, random.pick(values)]] : []
      )
    )
    const pick = <T>(...values: T[]): T => random.pick(values)
    return {
      ...scalars,
      tun: pick(undefined, {
        enable: random.chance(0.7),
        ...someOf(random, {
          stack: 'mixed',
          device: pick('', 'utun9', 'tun0'),
          'auto-route': random.chance(0.5),
          'auto-detect-interface': random.chance(0.5),
          'auto-redirect': random.chance(0.5),
          'strict-route': random.chance(0.5),
          'dns-hijack': pick([], ['any:53']),
          'route-exclude-address': pick([], ['192.168.0.0/16'])
        })
      }),
      dns: pick(undefined, {
        enable: random.chance(0.8),
        ...someOf(random, {
          'respect-rules': random.chance(0.5),
          'proxy-server-nameserver': pick([], ['223.5.5.5']),
          nameserver: pick([], ['8.8.8.8']),
          'direct-nameserver': pick([], ['223.5.5.5']),
          'fake-ip-filter': pick([], ['*.lan']),
          'fake-ip-range': pick([], ['198.18.0.1/16']),
          'nameserver-policy': pick({}, { 'geosite:cn': '223.5.5.5' }),
          'proxy-server-nameserver-policy': pick({}, { 'geosite:cn': '223.5.5.5' }),
          ipv6: random.chance(0.5)
        })
      }),
      sniffer: pick(undefined, { enable: random.chance(0.5), 'parse-pure-ip': true })
    }
  }

  const isEmpty = (value: unknown): boolean =>
    Array.isArray(value) ? value.length === 0 : Object.keys(value as object).length === 0

  function assertKernelReady(input: Fields, output: Fields, controlDns: boolean): void {
    assert.ok(['debug', 'info'].includes(output['log-level'] as string))
    assert.notEqual(output.mode, 'rule', 'the default mode is not written out')

    if (input['external-controller'] === '') {
      for (const key of ['external-ui', 'external-ui-url', 'external-controller-cors']) {
        assert.equal(key in output, false, `${key} goes away with an empty controller address`)
      }
    }
    if (output['allow-lan'] !== true) {
      assert.equal('lan-allowed-ips' in output, false)
      assert.equal('lan-disallowed-ips' in output, false)
    }
    const tun = output.tun as Fields | undefined
    assert.ok(tun === undefined || tun.enable === true, 'a disabled TUN is dropped')
    for (const key of ['proxies', 'proxy-groups', 'rules', 'proxy-providers', 'rule-providers']) {
      assert.ok(!(key in output) || !isEmpty(output[key]), `${key} must not be empty`)
    }

    const dns = output.dns as Fields | undefined
    if (!controlDns) {
      assert.deepEqual(dns, input.dns, 'DNS the app does not control stays untouched')
    } else if (dns) {
      assert.equal(dns.enable, true)
      const proxyServerNameserver = dns['proxy-server-nameserver'] as string[] | undefined
      assert.ok(
        dns['respect-rules'] !== true || (proxyServerNameserver?.length ?? 0) > 0,
        'the kernel rejects respect-rules without a proxy server nameserver'
      )
    }
    for (const key of ['secret', 'interface-name', 'global-client-fingerprint']) {
      if (input[key]) assert.equal(output[key], input[key], `${key} is the user's own value`)
    }
  }

  it('produces kernel-ready output that cleaning again would not change', async () => {
    await forSeedsAsync(RUNS, async (random) => {
      const input = randomProfile(random)
      const controlDns = random.chance(0.8)
      const controlSniff = random.chance(0.8)

      const output = await clean(input, controlDns, controlSniff)

      assertKernelReady(input, output, controlDns)
      assert.deepEqual(await clean(output, controlDns, controlSniff), output)
    })
  })
})

describe('runtime config fingerprint (random sections)', () => {
  const SECTIONS = ['rules', 'sub-rules', 'rule-providers', 'proxy-groups', 'proxy-providers']

  function randomSections(random: Random): Fields {
    return Object.fromEntries(
      SECTIONS.flatMap((key) =>
        random.chance(0.7)
          ? [[key, random.pick([[], ['MATCH,DIRECT'], { a: 1 }, null, { a: { b: [1, 2, 3] } }])]]
          : []
      )
    )
  }

  it('depends on the reload-sensitive sections and on nothing else', () => {
    forSeeds(RUNS, (random, seed) => {
      const sections = randomSections(random)
      const fingerprint = fingerprintRuntimeConfig(sections)

      // 运行时传入的是整份配置，端口 / DNS 等其余字段不得影响指纹。
      const wholeConfig: Fields = { ...sections, port: seed, dns: { enable: true }, mode: 'global' }

      assert.equal(fingerprintRuntimeConfig(structuredClone(sections)), fingerprint)
      assert.equal(fingerprintRuntimeConfig(wholeConfig), fingerprint)
      for (const key of SECTIONS) {
        assert.notEqual(
          fingerprintRuntimeConfig({ ...sections, [key]: { changed: seed } }),
          fingerprint,
          `${key} must be part of the fingerprint`
        )
      }
    })
  })

  it('treats a missing section like an explicit null', () => {
    assert.equal(
      fingerprintRuntimeConfig({}),
      fingerprintRuntimeConfig({ rules: undefined, 'proxy-groups': null })
    )
  })
})
