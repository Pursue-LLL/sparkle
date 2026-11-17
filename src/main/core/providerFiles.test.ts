import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import { parseYaml } from '../utils/yaml'
import type * as Provider from './provider'

type Proxy = Record<string, unknown>

const commercial = (name: string): Proxy => ({ name, type: 'ss', server: `${name}.example.com` })
const vpsNode = (name: string): Proxy => ({ name, type: 'trojan', server: 'vps.example.com' })
const visionNode = (name: string): Proxy => ({
  name,
  type: 'vless',
  flow: 'xtls-rprx-vision',
  multiplex: { enabled: true },
  server: 'vps.example.com'
})

const anytlsNode = (name: string, extra: Proxy = {}): Proxy => ({
  name,
  type: 'anytls',
  server: `${name}.example.com`,
  port: 8443,
  ...extra
})

const calls: string[] = []
const logs: string[] = []
let failing = new Set<string>()
let root = ''
let profilesDir = ''
let workDir = ''

const fileOf = (id: string): string => path.join(profilesDir, `${id}-proxies.yaml`)
const nodesIn = (id: string): Proxy[] =>
  parseYaml<{ proxies: Proxy[] }>(readFileSync(fileOf(id), 'utf8')).proxies ?? []
const namesIn = (id: string): string[] => nodesIn(id).map((proxy) => String(proxy.name))

describe('provider files', () => {
  let provider: typeof Provider

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sparkle-provider-files-'))
    mock.module('../utils/dirs', {
      exports: { profilesDir: () => profilesDir, mihomoWorkDir: () => workDir }
    })
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          logs.push(line)
        }
      }
    })
    mock.module('./mihomoApi', {
      exports: {
        mihomoUpdateProxyProviders: async (id: string): Promise<void> => {
          calls.push(`update:${id}`)
          if (failing.has(id)) {
            throw new Error(`${id} not found`)
          }
        }
      }
    })
    mock.module('./autoSwitchPinRelease', {
      exports: {
        releaseAutoSwitchPins: async (scope: string): Promise<void> => {
          calls.push(`release:${scope}`)
        }
      }
    })
    provider = require('./provider') as typeof Provider
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    calls.length = 0
    logs.length = 0
    failing = new Set()
    profilesDir = path.join(root, 'profiles')
    workDir = path.join(root, 'work')
    rmSync(profilesDir, { recursive: true, force: true })
    mkdirSync(profilesDir, { recursive: true })
    mkdirSync(workDir, { recursive: true })
  })

  describe('extractProxies', () => {
    const profileWith = (...proxies: Proxy[]): MihomoConfig =>
      ({ proxies }) as unknown as MihomoConfig

    it('lists the commercial nodes first and the VPS nodes last', () => {
      const proxies = provider.extractProxies(
        profileWith(vpsNode('KR-VPS-HY2'), commercial('a'), commercial('b'))
      )

      assert.deepEqual(proxies, [commercial('a'), commercial('b'), vpsNode('KR-VPS-HY2')])
    })

    it('returns just the commercial nodes when there is no VPS node', () => {
      assert.deepEqual(provider.extractProxies(profileWith(commercial('a'))), [commercial('a')])
    })

    it('copes with a profile that has no proxies', () => {
      assert.deepEqual(provider.extractProxies({} as MihomoConfig), [])
    })

    it('keeps VLESS Vision nodes away from multiplexing', () => {
      const [node] = provider.extractProxies(profileWith(visionNode('v'))) as Proxy[]

      assert.equal(node.smux, false)
      assert.equal('multiplex' in node, false)
    })

    it('stops AnyTLS nodes from reusing sessions, commercial and VPS alike, and leaves the rest alone', () => {
      const proxies = provider.extractProxies(
        profileWith(anytlsNode('台湾 01'), commercial('a'), anytlsNode('KR-VPS-AnyTLS'))
      )

      assert.deepEqual(proxies, [
        anytlsNode('台湾 01', { 'disable-reuse': true }),
        commercial('a'),
        anytlsNode('KR-VPS-AnyTLS', { 'disable-reuse': true })
      ])
    })

    it('keeps session reuse for an AnyTLS node whose subscription asks for it explicitly', () => {
      const [node] = provider.extractProxies(
        profileWith(anytlsNode('a', { 'disable-reuse': false }))
      ) as Proxy[]

      assert.equal(node['disable-reuse'], false)
    })
  })

  describe('generateProxyProvider', () => {
    it('writes the nodes to the provider file and returns its path', async () => {
      const file = await provider.generateProxyProvider('p1', [commercial('a'), commercial('b')])

      assert.equal(file, fileOf('p1'))
      assert.deepEqual(namesIn('p1'), ['a', 'b'])
    })

    it('keeps VLESS Vision nodes away from multiplexing', async () => {
      await provider.generateProxyProvider('p1', [visionNode('v')])

      const [node] = parseYaml<{ proxies: Proxy[] }>(readFileSync(fileOf('p1'), 'utf8')).proxies
      assert.equal(node.smux, false)
      assert.equal('multiplex' in node, false)
    })

    it('stops AnyTLS nodes from reusing sessions even when handed raw nodes', async () => {
      await provider.generateProxyProvider('p1', [anytlsNode('a'), commercial('b')])

      assert.deepEqual(nodesIn('p1'), [anytlsNode('a', { 'disable-reuse': true }), commercial('b')])
    })
  })

  describe('setupProfileProviders', () => {
    it('writes one provider file when there are no VPS nodes, and clears a stale VPS file', async () => {
      writeFileSync(fileOf('p1-vps'), 'proxies: []\n')

      const result = await provider.setupProfileProviders('p1', [commercial('a'), commercial('b')])

      assert.deepEqual(namesIn('p1'), ['a', 'b'])
      assert.equal(existsSync(fileOf('p1-vps')), false)
      assert.deepEqual(result.vps, [])
      assert.deepEqual(result.commercial, [commercial('a'), commercial('b')])
    })

    it('keeps no VPS file around when there never was one', async () => {
      await provider.setupProfileProviders('p1', [commercial('a')])

      assert.equal(existsSync(fileOf('p1-vps')), false)
    })

    it('splits VPS nodes into their own provider file', async () => {
      const result = await provider.setupProfileProviders('p1', [
        commercial('a'),
        vpsNode('KR-VPS-HY2'),
        commercial('b')
      ])

      assert.deepEqual(namesIn('p1'), ['a', 'b'])
      assert.deepEqual(namesIn('p1-vps'), ['KR-VPS-HY2'])
      assert.deepEqual(result.commercial, [commercial('a'), commercial('b')])
      assert.deepEqual(result.vps, [vpsNode('KR-VPS-HY2')])
      assert.deepEqual(logs, [])
    })

    it('logs what the Vision guard changed on the VPS nodes', async () => {
      await provider.setupProfileProviders('p1', [commercial('a'), visionNode('KR-VPS-Reality')])

      assert.deepEqual(logs, [
        '[Provider]: vless_vision_mux_guard vision=1 stripped_multiplex=1 ensured_smux_off=1 nodes=[KR-VPS-Reality]\n'
      ])
    })

    it('writes every AnyTLS node with session reuse off, in the commercial and the VPS file alike', async () => {
      await provider.setupProfileProviders('p1', [
        anytlsNode('a'),
        vpsNode('KR-VPS-HY2'),
        anytlsNode('KR-VPS-AnyTLS')
      ])

      assert.deepEqual(nodesIn('p1'), [anytlsNode('a', { 'disable-reuse': true })])
      assert.deepEqual(nodesIn('p1-vps'), [
        vpsNode('KR-VPS-HY2'),
        anytlsNode('KR-VPS-AnyTLS', { 'disable-reuse': true })
      ])
    })

    it('logs how many AnyTLS nodes have session reuse off, so an explicit opt-out shows up', async () => {
      await provider.setupProfileProviders('p1', [
        anytlsNode('台湾 01'),
        anytlsNode('台湾 02', { 'disable-reuse': false }),
        commercial('a')
      ])

      assert.deepEqual(logs, [
        '[Provider]: anytls_reuse_guard anytls=2 reuse_disabled=1 nodes=[台湾 01,台湾 02]\n'
      ])
    })
  })

  describe('reloadMihomoProfileProviders', () => {
    it('reloads every provider, then lets go of pins that lost their node', async () => {
      await provider.reloadMihomoProfileProviders('p1', true)

      assert.deepEqual(calls, [
        'update:p1',
        'update:p1-vps',
        'update:sparkle-fast',
        'update:sparkle-mail',
        'update:sparkle-agy',
        'update:sparkle-grok',
        'update:gemini专用',
        'release:orphans'
      ])
    })

    it('skips the VPS provider when the profile has none', async () => {
      await provider.reloadMihomoProfileProviders('p1', false)

      assert.ok(!calls.includes('update:p1-vps'))
      assert.equal(calls.at(-1), 'release:orphans')
    })

    it('carries on when a sparkle provider is not enabled', async () => {
      failing = new Set([
        'sparkle-fast',
        'sparkle-mail',
        'sparkle-agy',
        'sparkle-grok',
        'gemini专用'
      ])

      await provider.reloadMihomoProfileProviders('p1', false)

      assert.deepEqual(calls, [
        'update:p1',
        'update:sparkle-fast',
        'update:sparkle-mail',
        'update:sparkle-agy',
        'update:sparkle-grok',
        'update:gemini专用',
        'release:orphans'
      ])
    })

    it('fails when the subscription provider itself cannot be reloaded', async () => {
      failing = new Set(['p1'])

      await assert.rejects(provider.reloadMihomoProfileProviders('p1', true), /p1 not found/)

      assert.deepEqual(calls, ['update:p1'])
    })

    it('fails when the VPS provider cannot be reloaded', async () => {
      failing = new Set(['p1-vps'])

      await assert.rejects(provider.reloadMihomoProfileProviders('p1', true), /p1-vps not found/)

      assert.deepEqual(calls, ['update:p1', 'update:p1-vps'])
    })
  })

  describe('deleteProvider', () => {
    it('removes the provider file and the VPS provider file', async () => {
      writeFileSync(fileOf('p1'), 'proxies: []\n')
      writeFileSync(fileOf('p1-vps'), 'proxies: []\n')

      await provider.deleteProvider('p1')

      assert.equal(existsSync(fileOf('p1')), false)
      assert.equal(existsSync(fileOf('p1-vps')), false)
    })

    it('removes whichever of the two exists, and none is fine too', async () => {
      writeFileSync(fileOf('p1-vps'), 'proxies: []\n')
      await provider.deleteProvider('p1')
      assert.equal(existsSync(fileOf('p1-vps')), false)

      writeFileSync(fileOf('p2'), 'proxies: []\n')
      await provider.deleteProvider('p2')
      assert.equal(existsSync(fileOf('p2')), false)

      await provider.deleteProvider('p3')
    })
  })

  describe('generateBaseConfigWithProvider', () => {
    it('points the subscription provider at its file relative to the core work dir', () => {
      const config = provider.generateBaseConfigWithProvider(
        { proxies: [commercial('a')], rules: [] } as unknown as MihomoConfig,
        'p1'
      )

      const providers = config['proxy-providers'] as Record<string, { path: string }>
      assert.equal(providers.p1.path, path.relative(workDir, fileOf('p1')))
    })
  })
})
