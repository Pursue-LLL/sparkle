import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it, mock } from 'node:test'
import { parseYaml } from '../utils/yaml'
import { GROK_GROUP_ENABLED } from './cursorProxyGroup'
import type { writeSparkleProviderFiles } from './sparkleProviderFiles'

/**
 * 真实的 extractProxies → writeSparkleProviderFiles 链路：五个 Sparkle 专用 provider 的节点都取自
 * extractProxies，只有在这条链上 AnyTLS 防护才能保证「任何 provider 文件里的 AnyTLS 节点都不复用会话」。
 * 只替换边缘依赖（目录、日志、内核接口、探测缓存）。
 */

type Proxy = Record<string, unknown>

const FILES = [
  'sparkle-fast-proxies.yaml',
  'sparkle-mail-proxies.yaml',
  'sparkle-agy-proxies.yaml',
  ...(GROK_GROUP_ENABLED ? ['sparkle-grok-proxies.yaml'] : []),
  'gemini专用-proxies.yaml'
]

const subscription: Proxy[] = [
  { name: '台湾 01', type: 'anytls', server: 'tw1.example.com', port: 8443 },
  { name: '台湾 02', type: 'vless', server: 'tw2.example.com', port: 443 },
  { name: '日本 01', type: 'anytls', server: 'jp1.example.com', port: 8443 },
  { name: '日本 02', type: 'trojan', server: 'jp2.example.com', port: 443 }
]

describe('AnyTLS session reuse guard across every Sparkle provider file', () => {
  let write: typeof writeSparkleProviderFiles
  let profilesDir: string

  const nodesIn = (file: string): Proxy[] =>
    parseYaml<{ proxies: Proxy[] }>(readFileSync(path.join(profilesDir, file), 'utf8')).proxies

  before(async () => {
    profilesDir = mkdtempSync(path.join(tmpdir(), 'sparkle-anytls-pipeline-'))
    const empty = async (): Promise<Map<string, unknown>> => new Map()
    mock.module('../utils/dirs', {
      exports: { profilesDir: (): string => profilesDir, mihomoWorkDir: (): string => profilesDir }
    })
    mock.module('../utils/log', { exports: { appendAppLog: async (): Promise<void> => undefined } })
    mock.module('./mihomoApi', { exports: { mihomoUpdateProxyProviders: async () => undefined } })
    mock.module('./sparkleFastLatencyOrder', { exports: { loadSparkleFastDelaySnapshot: empty } })
    mock.module('./sparkleGeminiProbe', {
      exports: {
        loadGeminiBlockedNodeNames: async (): Promise<Set<string>> => new Set(),
        loadSparkleGeminiRegionCache: empty
      }
    })
    mock.module('./sparkleNodeQualityCache', {
      exports: { loadSunkNodeNames: async (): Promise<Set<string>> => new Set() }
    })
    mock.module('./sparkleMailProbe', { exports: { loadSparkleMailProbeCache: empty } })
    mock.module('./sparkleAgyProbeCache', { exports: { loadSparkleAgyProbeCache: empty } })
    mock.module('./sparkleGrokProbeCache', { exports: { loadSparkleGrokProbeCache: empty } })
    write = (await import('./sparkleProviderFiles')).writeSparkleProviderFiles
    await write({ proxies: subscription } as unknown as MihomoConfig, ['台湾', '日本'])
  })

  after(() => {
    rmSync(profilesDir, { recursive: true, force: true })
  })

  for (const file of FILES) {
    // 先断言文件确实带着两个 AnyTLS 节点：否则「每个 AnyTLS 节点都关了复用」会因没有节点而空真。
    it(`${file}: carries both AnyTLS nodes with session reuse off and touches no other node`, () => {
      const nodes = nodesIn(file)

      const anytlsNames = nodes.filter((node) => node.type === 'anytls').map((node) => node.name)
      assert.deepEqual(anytlsNames.sort(), ['台湾 01', '日本 01'])
      for (const node of nodes) {
        const expected = node.type === 'anytls' ? true : undefined
        assert.equal(node['disable-reuse'], expected, String(node.name))
      }
    })
  }
})
