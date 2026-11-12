// [INPUT] 当前订阅节点 · 探测缓存 · `sparkle-grok` provider 文件 · mihomo provider 重载接口
// [OUTPUT] readGrokProviderMembers · writeProviderDocument · writeGrokProviderFromCache · reloadGrokProvider · ensureGrokProviderReloaded
// [POS] provider 文件落盘与热重载：只有成员集合变化才标记待重载（顺序变化不打断 mihomo）；
// 重载失败只记一次日志，之后每轮继续重试，直到成功。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { mihomoUpdateProxyProviders } from './mihomoApi'
import {
  buildSparkleGrokProviderDocument,
  grokProviderMembershipChanged,
  grokProxyName,
  GROK_NODE_PROVIDER_FILENAME,
  GROK_NODE_PROVIDER_ID,
  type GrokNodeProbeCache,
  type GrokProxyRecord
} from './sparkleGrokProviderCore'

let providerReloadPending = false
let providerReloadFailing = false

function providerFilePath(): string {
  return path.join(profilesDir(), GROK_NODE_PROVIDER_FILENAME)
}

function namesOf(proxies: readonly GrokProxyRecord[]): string[] {
  return proxies.map(grokProxyName).filter((name) => name.length > 0)
}

export async function readGrokProviderMembers(): Promise<string[]> {
  try {
    const doc = parseYaml<{ proxies?: GrokProxyRecord[] }>(
      await readFile(providerFilePath(), 'utf8')
    )
    return namesOf(doc.proxies ?? [])
  } catch {
    return []
  }
}

/** 写入文档；成员集合与文件里原有的不同才标记待重载。 */
export async function writeProviderDocument(proxies: readonly GrokProxyRecord[]): Promise<void> {
  const previousMembers = await readGrokProviderMembers()
  await writeFile(providerFilePath(), stringifyYaml({ proxies: [...proxies] }), 'utf8')
  if (grokProviderMembershipChanged(previousMembers, namesOf(proxies))) {
    providerReloadPending = true
  }
}

/** 稳态：provider 只保留验证通过的节点（缓存没有可信结论时是全量订阅节点）。 */
export async function writeGrokProviderFromCache(
  proxies: readonly GrokProxyRecord[],
  cache: GrokNodeProbeCache
): Promise<void> {
  await writeProviderDocument(
    buildSparkleGrokProviderDocument({ proxies, probeCache: cache }).proxies
  )
}

export async function reloadGrokProvider(): Promise<void> {
  try {
    await mihomoUpdateProxyProviders(GROK_NODE_PROVIDER_ID)
    providerReloadPending = false
    providerReloadFailing = false
  } catch (error) {
    providerReloadPending = true
    if (!providerReloadFailing) {
      providerReloadFailing = true
      await appendAppLog(
        `[SparkleGrokProbe]: provider reload failed err=${error instanceof Error ? error.message : String(error)}\n`
      )
    }
  }
}

export async function ensureGrokProviderReloaded(): Promise<void> {
  if (!providerReloadPending) {
    return
  }
  await reloadGrokProvider()
}
