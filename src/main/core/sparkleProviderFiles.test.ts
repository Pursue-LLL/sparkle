import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import yaml from 'yaml'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import type { writeSparkleProviderFiles } from './sparkleProviderFiles'

type Proxy = Record<string, unknown>
type Provider = 'fast' | 'mail' | 'agy' | 'grok'

const FILES: Record<Provider, string> = {
  fast: 'sparkle-fast-proxies.yaml',
  mail: 'sparkle-mail-proxies.yaml',
  agy: 'sparkle-agy-proxies.yaml',
  grok: 'sparkle-grok-proxies.yaml'
}
const PROVIDERS = Object.keys(FILES) as Provider[]
const PREVIOUS = 'previous'

const NOW = Date.now()
const profile = {} as MihomoConfig
const taiwan: Proxy = { name: '台湾 01', type: 'vless', server: 'tw.example.com', port: 443 }
const japan: Proxy = { name: '日本 01', type: 'vless', server: 'jp.example.com', port: 443 }
const hongKong: Proxy = { name: '香港 01', type: 'vless', server: 'hk.example.com', port: 443 }

const state: {
  proxies: readonly Proxy[]
  extractFails: boolean
  delays: Map<string, number>
  blocked: Set<string>
  mailCache: Map<string, unknown>
  agyCache: Map<string, unknown>
  grokCache: Map<string, unknown>
  failing: Set<string>
} = {
  proxies: [],
  extractFails: false,
  delays: new Map(),
  blocked: new Set(),
  mailCache: new Map(),
  agyCache: new Map(),
  grokCache: new Map(),
  failing: new Set()
}

/** 探测缓存 / 延迟快照的读取；`state.failing` 里登记的名字会抛错，模拟磁盘或内核不可用。 */
function loader<Result>(label: string, read: () => Result): () => Promise<Result> {
  return async () => {
    if (state.failing.has(label)) {
      throw new Error(`${label} unavailable`)
    }
    return read()
  }
}

describe('writeSparkleProviderFiles', () => {
  let write: typeof writeSparkleProviderFiles
  let profilesDir: string

  const fileOf = (provider: Provider): string => path.join(profilesDir, FILES[provider])
  const contentOf = (provider: Provider): string => readFileSync(fileOf(provider), 'utf8')
  const namesIn = (provider: Provider): string[] =>
    (yaml.parse(contentOf(provider)) as { proxies: Proxy[] }).proxies.map((proxy) =>
      String(proxy.name)
    )
  const seedAll = (): void => {
    for (const provider of PROVIDERS) {
      writeFileSync(fileOf(provider), PREVIOUS, 'utf8')
    }
  }
  const untouched = (): Provider[] =>
    PROVIDERS.filter((provider) => contentOf(provider) === PREVIOUS)

  before(async () => {
    profilesDir = mkdtempSync(path.join(tmpdir(), 'sparkle-provider-files-'))
    mock.module('../utils/dirs', { exports: { profilesDir: (): string => profilesDir } })
    mock.module('./provider', {
      exports: {
        extractProxies: (): readonly Proxy[] => {
          if (state.extractFails) {
            throw new Error('profile unreadable')
          }
          return state.proxies
        }
      }
    })
    mock.module('./sparkleFastLatencyOrder', {
      exports: { loadSparkleFastDelaySnapshot: loader('fast-delays', () => state.delays) }
    })
    mock.module('./sparkleGeminiProbe', {
      exports: { loadGeminiBlockedNodeNames: loader('gemini', () => state.blocked) }
    })
    mock.module('./sparkleMailProbe', {
      exports: { loadSparkleMailProbeCache: loader('mail-cache', () => state.mailCache) }
    })
    mock.module('./sparkleAgyProbeCache', {
      exports: { loadSparkleAgyProbeCache: loader('agy-cache', () => state.agyCache) }
    })
    mock.module('./sparkleGrokProbeCache', {
      exports: { loadSparkleGrokProbeCache: loader('grok-cache', () => state.grokCache) }
    })
    write = (await import('./sparkleProviderFiles')).writeSparkleProviderFiles
  })

  beforeEach(() => {
    for (const provider of PROVIDERS) {
      rmSync(fileOf(provider), { force: true })
    }
    state.proxies = [japan, taiwan, hongKong]
    state.extractFails = false
    state.delays = new Map()
    state.blocked = new Set()
    state.mailCache = new Map()
    state.agyCache = new Map()
    state.grokCache = new Map()
    state.failing = new Set()
  })

  after(() => {
    rmSync(profilesDir, { recursive: true, force: true })
  })

  it('writes one provider file per Sparkle group, shaped by that group’s own rules', async () => {
    await write(profile, ['台湾', '日本'])

    assert.deepEqual(namesIn('fast'), ['台湾 01', '日本 01'], 'Hong Kong stays out of auto-select')
    assert.deepEqual(
      namesIn('mail'),
      ['台湾 01', '日本 01', '香港 01'],
      'Hong Kong is the last resort'
    )
    assert.deepEqual(namesIn('agy'), ['台湾 01', '日本 01'], 'Hong Kong is not an agy region')
    assert.deepEqual(
      namesIn('grok'),
      ['日本 01', '台湾 01', '香港 01'],
      'no samples keeps profile order'
    )
  })

  it('applies the configured region priority to every region-aware provider', async () => {
    await write(profile, ['日本', '台湾'])

    assert.deepEqual(namesIn('fast'), ['日本 01', '台湾 01'])
    assert.deepEqual(namesIn('mail'), ['日本 01', '台湾 01', '香港 01'])
    assert.deepEqual(namesIn('agy'), ['日本 01', '台湾 01'])
  })

  it('keeps nodes Google blocks for Gemini out of the fast provider', async () => {
    state.blocked = new Set(['台湾 01'])

    await write(profile, ['台湾', '日本'])

    assert.deepEqual(namesIn('fast'), ['日本 01'])
  })

  it('orders the fast provider by measured delay when samples exist', async () => {
    state.proxies = ['台湾 01', '台湾 02', '台湾 03'].map((name) => ({ ...taiwan, name }))
    state.delays = new Map([
      ['台湾 01', 300],
      ['台湾 02', 100],
      ['台湾 03', 200]
    ])

    await write(profile, ['台湾'])

    assert.deepEqual(namesIn('fast'), ['台湾 02', '台湾 03', '台湾 01'])
  })

  it('narrows the mail, agy and grok providers to the nodes their probes verified', async () => {
    state.mailCache = new Map([
      [computeProxyNodeFingerprint(japan), { alive: true, rttMs: 50, checkedAt: NOW }]
    ])
    state.agyCache = new Map([
      [computeProxyNodeFingerprint(taiwan), { usable: true, rttMs: 80, checkedAt: NOW }]
    ])
    state.grokCache = new Map([
      [computeProxyNodeFingerprint(hongKong), { alive: true, rttMs: 60, checkedAt: NOW }]
    ])

    await write(profile, ['台湾', '日本'])

    assert.deepEqual(namesIn('mail'), ['日本 01'])
    assert.deepEqual(namesIn('agy'), ['台湾 01'])
    assert.deepEqual(namesIn('grok'), ['香港 01'])
  })

  it('never reads a provider’s input from another provider’s cache', async () => {
    state.mailCache = new Map([
      [computeProxyNodeFingerprint(japan), { alive: true, rttMs: 50, checkedAt: NOW }]
    ])

    await write(profile, ['台湾', '日本'])

    assert.deepEqual(namesIn('agy'), ['台湾 01', '日本 01'])
    assert.deepEqual(namesIn('grok'), ['日本 01', '台湾 01', '香港 01'])
  })

  it('does not let a provider mutate the node list the others share', async () => {
    state.proxies = Object.freeze(
      [japan, taiwan, hongKong].map((proxy) => Object.freeze({ ...proxy }))
    )

    await write(profile, ['台湾', '日本'])

    assert.deepEqual(untouched(), [], 'no file may be missing')
    for (const provider of PROVIDERS) {
      assert.ok(namesIn(provider).length > 0, provider)
    }
  })

  describe('a provider with no usable node', () => {
    it('keeps the previous file of every provider that would come out empty', async () => {
      state.proxies = [{ ...taiwan, type: 'anytls' }]
      seedAll()

      await write(profile, ['台湾'])

      assert.deepEqual(untouched(), ['fast', 'mail', 'agy'])
      assert.deepEqual(namesIn('grok'), ['台湾 01'], 'grok takes any named node')
    })

    it('keeps every previous file when the profile has no usable nodes at all', async () => {
      state.proxies = [{ type: 'vless' }]
      seedAll()

      await write(profile, ['台湾'])

      assert.deepEqual(untouched(), PROVIDERS)
    })

    it('does not create a file for an empty provider', async () => {
      state.proxies = []

      await write(profile, ['台湾'])

      assert.deepEqual(
        PROVIDERS.filter((provider) => existsSync(fileOf(provider))),
        []
      )
    })
  })

  describe('failures stay local', () => {
    const CASES: ReadonlyArray<readonly [string, Provider]> = [
      ['fast-delays', 'fast'],
      ['gemini', 'fast'],
      ['mail-cache', 'mail'],
      ['agy-cache', 'agy'],
      ['grok-cache', 'grok']
    ]

    for (const [failing, affected] of CASES) {
      it(`keeps only the ${affected} file when ${failing} cannot be loaded`, async () => {
        seedAll()
        state.failing = new Set([failing])

        await write(profile, ['台湾'])

        assert.deepEqual(untouched(), [affected])
      })
    }

    it('keeps every previous file when the profile’s nodes cannot be read', async () => {
      seedAll()
      state.extractFails = true

      await assert.doesNotReject(write(profile, ['台湾']))

      assert.deepEqual(untouched(), PROVIDERS)
    })

    it('swallows a profiles directory that cannot be written', async () => {
      const original = profilesDir
      profilesDir = path.join(original, 'missing', 'dir')

      try {
        await assert.doesNotReject(write(profile, ['台湾']))
        assert.equal(existsSync(profilesDir), false)
      } finally {
        profilesDir = original
      }
    })
  })
})
