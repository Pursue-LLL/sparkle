// [INPUT] provider::extractProxies · regionPriority · sparkle-fast/mail/agy/grok provider 文档构建与探测缓存
// [OUTPUT] writeSparkleProviderFiles: 落盘 Sparkle 专用 proxy-provider 文件
// [POS] runtime 配置生成流水线的 provider 文件层。best-effort：写失败沿用上一份文件，空 provider 不落盘（mihomo 会拒绝加载含空 provider 的整份配置）。

import { writeFileSync } from 'fs'
import path from 'path'
import { profilesDir } from '../utils/dirs'
import { stringifyYaml } from '../utils/yaml'
import { extractProxies } from './provider'
import { resolveEffectiveRegionPriority } from './regionPriority'

export async function writeSparkleProviderFiles(
  currentProfile: MihomoConfig,
  proxySwitchPriority: string[]
): Promise<void> {
  try {
    const { buildSparkleFastProviderDocument, FAST_NODE_PROVIDER_FILENAME } = await import(
      './sparkleFastProviderCore'
    )
    const { loadSparkleFastDelaySnapshot } = await import('./sparkleFastLatencyOrder')
    const { loadGeminiBlockedNodeNames } = await import('./sparkleGeminiProbe')
    const fastInputProxies = extractProxies(currentProfile) as unknown as Array<
      Record<string, unknown>
    >
    const [delaySnapshot, blockedNodeNames] = await Promise.all([
      loadSparkleFastDelaySnapshot(fastInputProxies),
      loadGeminiBlockedNodeNames(fastInputProxies)
    ])
    writeFileSync(
      path.join(profilesDir(), FAST_NODE_PROVIDER_FILENAME),
      stringifyYaml(
        buildSparkleFastProviderDocument({
          proxies: fastInputProxies,
          regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority),
          delayMs: delaySnapshot.size ? delaySnapshot : undefined,
          blockedNodeNames
        })
      ),
      'utf8'
    )
  } catch {
    // best-effort：写失败沿用上一份 sparkle-fast 文件
  }
  try {
    const { buildSparkleMailProviderDocument, MAIL_NODE_PROVIDER_FILENAME } = await import(
      './sparkleMailProviderCore'
    )
    const { loadSparkleMailProbeCache } = await import('./sparkleMailProbe')
    const mailProbeCache = await loadSparkleMailProbeCache()
    writeFileSync(
      path.join(profilesDir(), MAIL_NODE_PROVIDER_FILENAME),
      stringifyYaml(
        buildSparkleMailProviderDocument({
          proxies: extractProxies(currentProfile) as unknown as Array<Record<string, unknown>>,
          regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority),
          probeCache: mailProbeCache.size ? mailProbeCache : undefined
        })
      ),
      'utf8'
    )
  } catch {
    // best-effort：写失败沿用上一份 sparkle-mail 文件
  }
  try {
    const { buildSparkleAgyProviderDocument, AGY_NODE_PROVIDER_FILENAME } = await import(
      './sparkleAgyProviderCore'
    )
    const { loadSparkleAgyProbeCache } = await import('./sparkleAgyProbeCache')
    const agyProbeCache = await loadSparkleAgyProbeCache()
    const agyDocument = buildSparkleAgyProviderDocument({
      proxies: extractProxies(currentProfile) as unknown as Array<Record<string, unknown>>,
      regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority),
      probeCache: agyProbeCache.size ? agyProbeCache : undefined
    })
    // 空 provider 会让 mihomo 拒绝加载整份配置：宁可沿用上一份，也不要写空文件。
    if (agyDocument.proxies.length > 0) {
      writeFileSync(
        path.join(profilesDir(), AGY_NODE_PROVIDER_FILENAME),
        stringifyYaml(agyDocument),
        'utf8'
      )
    }
  } catch {
    // best-effort：写失败沿用上一份 sparkle-agy 文件
  }
  try {
    const { buildSparkleGrokProviderDocument, GROK_NODE_PROVIDER_FILENAME } = await import(
      './sparkleGrokProviderCore'
    )
    const { loadSparkleGrokProbeCache } = await import('./sparkleGrokProbe')
    const grokProbeCache = await loadSparkleGrokProbeCache()
    const grokDocument = buildSparkleGrokProviderDocument({
      proxies: extractProxies(currentProfile) as unknown as Array<Record<string, unknown>>,
      probeCache: grokProbeCache.size ? grokProbeCache : undefined
    })
    // 空 provider 会让 mihomo 拒绝加载整份配置：没有节点时沿用上一份文件。
    if (grokDocument.proxies.length > 0) {
      writeFileSync(
        path.join(profilesDir(), GROK_NODE_PROVIDER_FILENAME),
        stringifyYaml(grokDocument),
        'utf8'
      )
    }
  } catch {
    // best-effort：写失败沿用上一份 sparkle-grok 文件
  }
}
