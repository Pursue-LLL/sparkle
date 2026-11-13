import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import yaml from 'yaml'
import {
  GROUP,
  groupNames,
  groupOf,
  loadFactoryRig,
  proxy,
  rulesOf,
  subscription,
  type FactoryRig,
  type Json,
  type RigState
} from './factoryRig'

const LEGACY_CURSOR_GROUP = '🎯 Cursor-专用'

describe('factory: runtime config pipeline', () => {
  let rig: FactoryRig
  let state: RigState

  before(async () => {
    rig = await loadFactoryRig()
    state = rig.state
  })
  beforeEach(() => rig.reset())
  after(() => rig.dispose())

  describe('a subscription served through providers', () => {
    it('writes the merged runtime config and the node providers it refers to', async () => {
      const config = await rig.generate()

      assert.equal(
        readFileSync(rig.configFile('work'), 'utf8'),
        await rig.factory.getRuntimeConfigStr()
      )
      assert.equal(config.proxies, undefined, 'nodes live in providers, not in the config')
      assert.deepEqual(Object.keys(config['proxy-providers'] as Json).sort(), [
        'gemini专用',
        'p1',
        'sparkle-agy',
        'sparkle-fast',
        'sparkle-grok',
        'sparkle-mail'
      ])
      const provider = yaml.parse(
        readFileSync(path.join(rig.profilesDir, 'p1-proxies.yaml'), 'utf8')
      )
      assert.deepEqual(
        (provider.proxies as Json[]).map(({ name }) => name),
        ['台湾 01', '日本 01']
      )
      assert.equal(config['mixed-port'], 7890, 'the controlled settings are merged in')
    })

    it('uses providers even for a subscription with a single node', async () => {
      state.profile = subscription({ proxies: [proxy('台湾 01')] })

      const config = await rig.generate()

      assert.ok('p1' in (config['proxy-providers'] as Json))
      assert.ok(existsSync(path.join(rig.profilesDir, 'p1-proxies.yaml')))
    })

    it('builds the Sparkle groups and keeps the subscription’s own rule last', async () => {
      const config = await rig.generate()

      assert.deepEqual(groupNames(config), [
        '自动选择',
        '🎯 Cursor 专用',
        'grok 专用',
        'gemini专用',
        '📧 邮件专用',
        '__sparkle_mail_probe__',
        '🎯 agy 专用',
        'Sparkle-台湾',
        'Sparkle-日本',
        'Sparkle-香港',
        GROUP
      ])
      assert.deepEqual(groupOf(config, '自动选择')?.use, ['sparkle-fast'])
      assert.equal(rulesOf(config).at(-1), `MATCH,${GROUP}`)
    })

    it('applies each step once, groups before the rules that need them', async () => {
      await rig.generate()

      const expected = [
        'begin',
        'override_profile',
        'setup_profile_providers',
        'merge_provider_base',
        'clean_profile',
        'auto_switch_groups',
        'vps_direct_bypass',
        'cursor_rules',
        'corporate_dns',
        'integrity_patches',
        'antigravity_geo_rules',
        'cn_direct_baseline',
        'match_fallback',
        'quic_traffic_rules',
        'stringify_runtime'
      ]
      assert.deepEqual(rig.steps().slice(0, -1), expected)
      assert.match(rig.steps().at(-1) ?? '', /^done groups=11$/)
    })

    it('adds every built-in rule set around the subscription’s rules', async () => {
      const rules = rulesOf(await rig.generate())

      assert.deepEqual(rules.slice(0, 2), [
        'AND,((DST-PORT,443),(NETWORK,UDP)),REJECT',
        'DOMAIN-SUFFIX,stun.cloudflare.com,REJECT'
      ])
      for (const expected of [
        'DOMAIN-KEYWORD,cloudcode-pa,🎯 agy 专用',
        'DOMAIN-SUFFIX,opencode.ai,DIRECT',
        'DOMAIN-SUFFIX,koolearn.com,DIRECT',
        'DOMAIN-SUFFIX,grok.com,grok 专用',
        'DOMAIN-SUFFIX,gemini.google.com,gemini专用',
        'DOMAIN-SUFFIX,aistudio.google.com,gemini专用',
        'DOMAIN,imap.gmail.com,📧 邮件专用',
        'PROCESS-PATH-REGEX,^/Applications/Cursor\\.app/,🎯 Cursor 专用',
        `DOMAIN-SUFFIX,example.com,${GROUP}`
      ]) {
        assert.ok(rules.includes(expected), expected)
      }
    })

    it('cleans, completes and hardens the controlled settings', async () => {
      state.controlled = {
        'mixed-port': 7890,
        mode: 'rule',
        'log-level': 'warning',
        tun: { enable: true, 'strict-route': false },
        dns: { enable: true, 'enhanced-mode': 'fake-ip', nameserver: ['114.114.114.114'] },
        sniffer: { enable: true }
      }

      const config = await rig.generate()
      const dns = config.dns as Json

      assert.equal(config['log-level'], 'info')
      assert.equal(config.mode, undefined, 'the default mode is not written out')
      assert.equal(config['keep-alive-idle'], 3600)
      assert.equal((config.tun as Json)['strict-route'], true)
      assert.ok(Object.keys(dns['nameserver-policy'] as Json).includes('+.koolearn.com'))
      assert.ok((dns['fake-ip-filter'] as string[]).includes('+.cursor.sh'))
      assert.ok((dns.fallback as string[]).length > 0)
      assert.equal((config.sniffer as Json)['parse-pure-ip'], true)
      assert.equal((config.sniffer as Json)['force-dns-mapping'], true)
    })

    it('hands the subscription and the switching priority to the provider file writer', async () => {
      state.appConfig = { proxySwitchPriority: ['日本', '台湾'] }

      await rig.generate()

      assert.equal(state.providerFileWrites.length, 1)
      const [profile, priority] = state.providerFileWrites[0] as [Json, string[]]
      assert.equal((profile.proxies as unknown[]).length, 2)
      assert.deepEqual(priority, ['日本', '台湾'])
    })

    it('hands the subscription’s nodes to the VPS direct bypass', async () => {
      await rig.generate()

      assert.equal(state.vpsBypassCalls.length, 1)
      const [, nodes] = state.vpsBypassCalls[0] as [Json, Json[]]
      assert.deepEqual(
        nodes.map(({ name }) => name),
        ['台湾 01', '日本 01']
      )
    })

    it('exposes the profile at each stage of the pipeline', async () => {
      await rig.generate()

      assert.equal(await rig.factory.getRawProfileStr(), 'raw: profile')
      assert.match(await rig.factory.getCurrentProfileStr(), /proxy-groups/)
      assert.match(await rig.factory.getOverrideProfileStr(), /台湾 01/)
    })
  })

  describe('a subscription without providers', () => {
    it('keeps the nodes inline when no profile is selected', async () => {
      for (const current of [undefined, 'default']) {
        state.current = current
        state.logs = []

        const config = await rig.generate()

        assert.equal(config['proxy-providers'], undefined, String(current))
        assert.deepEqual(
          (config.proxies as Json[]).map(({ name }) => name),
          ['台湾 01', '日本 01'],
          String(current)
        )
        assert.equal(rig.steps().includes('setup_profile_providers'), false, String(current))
        assert.equal(
          state.logs.some((line) => line.includes('vless_vision_mux_guard')),
          false,
          'nothing to report without Vision nodes'
        )
      }
    })

    it('keeps the config inline when the subscription has no nodes yet', async () => {
      state.profile = subscription({ proxies: [] })

      await rig.generate()

      assert.equal(existsSync(path.join(rig.profilesDir, 'p1-proxies.yaml')), false)
      assert.equal(rig.steps().includes('merge_provider_base'), false)
    })

    it('forces smux off for Vision nodes and reports what it stripped', async () => {
      state.current = 'default'
      state.profile = subscription({
        proxies: [proxy('台湾 01', { flow: 'xtls-rprx-vision', multiplex: { enabled: true } })]
      })

      const [node] = (await rig.generate()).proxies as Json[]

      assert.equal(node.smux, false)
      assert.equal('multiplex' in node, false)
      assert.ok(
        state.logs.includes(
          '[Factory]: vless_vision_mux_guard vision=1 stripped_multiplex=1 ensured_smux_off=1 nodes=[台湾 01]\n'
        )
      )
    })

  it('keeps AnyTLS nodes in the automatic groups like any other protocol', async () => {
    state.current = 'default'
    state.profile = subscription({
      proxies: [proxy('台湾 01', { type: ' AnyTLS ' }), proxy('台湾 02'), proxy('日本 01')]
    })

    const config = await rig.generate()

    assert.deepEqual(groupOf(config, 'Sparkle-台湾')?.proxies, ['台湾 01', '台湾 02'])
  })
  })

  describe('nodes of every shape', () => {
  it('keeps AnyTLS nodes in an inline url-test group', async () => {
    state.current = 'default'
    state.profile = subscription({
      proxies: [proxy('A', { type: 'anytls' }), proxy('B', { type: 'trojan' })],
      'proxy-groups': [
        { name: GROUP, type: 'select', proxies: ['🇭🇰 香港节点', 'DIRECT'] },
        {
          name: '🇭🇰 香港节点',
          type: 'url-test',
          url: 'https://example.com',
          interval: 300,
          proxies: ['A', 'B']
        }
      ]
    })

    const config = await rig.generate()

    assert.deepEqual(groupOf(config, '🇭🇰 香港节点')?.proxies, ['A', 'B'])
  })

    it('copes with nodes that have no usable name or no type, and keeps one-letter names', async () => {
      state.current = 'default'
      state.profile = subscription({
        proxies: [
          proxy('A'),
          { type: 'ss', server: 'nameless.example.com', port: 1 },
          { name: '', type: 'ss', server: 'empty.example.com', port: 1 },
          { name: '  ', type: 'ss', server: 'blank.example.com', port: 1 },
          { name: 5, type: 'ss', server: 'numeric.example.com', port: 1 },
          { name: '无类型', server: 'untyped.example.com', port: 1 }
        ],
        'proxy-groups': [{ name: GROUP, type: 'select', proxies: ['A', '无类型', '', 'DIRECT'] }]
      })

      const members = groupOf(await rig.generate(), GROUP)?.proxies as string[]

      assert.ok(members.includes('A'))
      assert.ok(members.includes('无类型'))
      assert.equal(members.includes(''), false, 'a node without a name is not a member to keep')
    })
  })

  describe('controlled settings', () => {
    it('merges controlled DNS and sniffer settings only while they are controlled', async () => {
      state.controlled = { hosts: { 'a.example': '1.1.1.1' }, sniffer: { enable: true } }
      const controlled = await rig.generate()

      state.appConfig = { controlDns: false, controlSniff: false }
      const released = await rig.generate()

      assert.deepEqual(controlled.hosts, { 'a.example': '1.1.1.1' })
      assert.deepEqual(controlled.sniffer, { enable: true })
      assert.equal(released.hosts, undefined)
      assert.equal(released.sniffer, undefined)
    })

    it('adds the Cursor domain rules unless Cursor optimisation is off', async () => {
      const optimised = rulesOf(await rig.generate())

      state.appConfig = { cursorBidiOptimize: false }
      const plain = rulesOf(await rig.generate())

      assert.ok(optimised.some((rule) => rule.includes('cursor.sh')))
      assert.equal(
        plain.some((rule) => rule.includes('cursor.sh')),
        false
      )
    })

    it('applies the Cursor rules to the app paths that were configured', async () => {
      state.appConfig = { cursorProxyAppPathPrefixes: ['/Applications/Foo.app'] }

      const rules = rulesOf(await rig.generate())

      assert.ok(rules.some((rule) => rule.includes('Foo\\.app')))
    })

    it('announces the rename of the legacy Cursor group once', async () => {
      state.profile = subscription({
        rules: [`DOMAIN-SUFFIX,example.com,${LEGACY_CURSOR_GROUP}`, `MATCH,${GROUP}`]
      })

      await rig.generate()
      const rules = rulesOf(await rig.generate())

      assert.equal(state.notifications.length, 1)
      assert.equal(state.notifications[0].title, 'Cursor 代理组已更新')
      assert.equal(state.logs.filter((line) => line.includes('Cursor 代理组已统一为')).length, 1)
      assert.equal(
        rules.some((rule) => rule.includes(LEGACY_CURSOR_GROUP)),
        false
      )
    })
  })
})
