// [INPUT] provider::extractProxies · regionPriority · sparkle-fast/mail/agy/grok/gemini provider 文档构建与探测缓存 ·
//         sparkleAgyProbeCache::loadSparkleAgyProbeCache (POS: agy 探测缓存读写) ·
//         sparkleAgyProviderCore::buildSparkleAgyProviderDocument/AGY_NODE_PROVIDER_FILENAME (POS: agy provider 与分组配置) ·
//         dedicatedGroups::DEDICATED_GROUP_IDS (POS: 可开关专用组注册表与开关解析) ·
//         sparkleFastLatencyOrder::loadSparkleFastDelaySnapshot (POS: sparkle-fast 延迟序运行时) ·
//         sparkleFastProviderCore::buildSparkleFastProviderDocument/FAST_NODE_PROVIDER_FILENAME (POS: sparkle-fast provider 文件生成) ·
//         sparkleFastProviderExclusions::loadFastProviderExclusions (POS: sparkle-fast 剔除/沉底依据) ·
//         sparkleGeminiProviderCore::buildSparkleGeminiProviderDocument/GEMINI_NODE_PROVIDER_FILENAME (POS: gemini provider 与分组配置) ·
//         sparkleGeminiRegionCache::loadSparkleGeminiRegionCache (POS: Gemini 地区判定缓存) ·
//         sparkleGeminiStabilityStore::loadGeminiStabilityLedger (POS: Gemini 节点稳定度台账) ·
//         sparkleGrokProbeCache::loadSparkleGrokProbeCache (POS: grok 探测缓存) ·
//         sparkleGrokProviderCore::buildSparkleGrokProviderDocument/GROK_NODE_PROVIDER_FILENAME (POS: grok provider 与快照) ·
//         sparkleMailProbe::loadSparkleMailProbeCache (POS: 邮件 provider 全量探测) ·
//         sparkleMailProviderCore::buildSparkleMailProviderDocument/MAIL_NODE_PROVIDER_FILENAME (POS: 邮件 provider 与分组配置) ·
//         utils/dirs::profilesDir (POS: 应用目录与路径常量) ·
//         utils/yaml::stringifyYaml (POS: YAML 解析与序列化)
// [OUTPUT] writeSparkleProviderFiles: 落盘 Sparkle 专用 proxy-provider 文件
// [POS] runtime 配置生成流水线的 provider 文件层。best-effort：写失败沿用上一份文件；空 provider 不落盘（mihomo 重载空 provider 不报错，但整组会静默退化为 COMPATIBLE 直连）。

import { writeFileSync } from 'fs'
import path from 'path'
import { profilesDir } from '../utils/dirs'
import { stringifyYaml } from '../utils/yaml'
import { DEDICATED_GROUP_IDS, type DedicatedGroupId } from './dedicatedGroups'
import { extractProxies } from './provider'
import { resolveEffectiveRegionPriority } from './regionPriority'

type ProxyRecord = Record<string, unknown>

interface ProviderInput {
  proxies: ProxyRecord[]
  regionPriority: string[]
}

interface ProviderFile {
  filename: string
  document: { proxies: readonly unknown[] }
}

type ProviderFileBuilder = (input: ProviderInput) => Promise<ProviderFile>

/*
 * 各 Sparkle 专用 provider：产出目标文件名与文档。
 * 构建模块与探测缓存按需加载：它们依赖 mihomo / 日志，只在写 provider 时才用得到。
 */

const buildFastProviderFile: ProviderFileBuilder = async ({ proxies, regionPriority }) => {
  const { buildSparkleFastProviderDocument, FAST_NODE_PROVIDER_FILENAME } =
    await import('./sparkleFastProviderCore')
  const { loadSparkleFastDelaySnapshot } = await import('./sparkleFastLatencyOrder')
  const { loadFastProviderExclusions } = await import('./sparkleFastProviderExclusions')
  const [delaySnapshot, exclusions] = await Promise.all([
    loadSparkleFastDelaySnapshot(proxies),
    loadFastProviderExclusions(proxies)
  ])
  return {
    filename: FAST_NODE_PROVIDER_FILENAME,
    document: buildSparkleFastProviderDocument({
      proxies,
      regionPriority,
      delayMs: delaySnapshot,
      ...exclusions
    })
  }
}

const buildMailProviderFile: ProviderFileBuilder = async ({ proxies, regionPriority }) => {
  const { buildSparkleMailProviderDocument, MAIL_NODE_PROVIDER_FILENAME } =
    await import('./sparkleMailProviderCore')
  const { loadSparkleMailProbeCache } = await import('./sparkleMailProbe')
  const probeCache = await loadSparkleMailProbeCache()
  return {
    filename: MAIL_NODE_PROVIDER_FILENAME,
    document: buildSparkleMailProviderDocument({
      proxies,
      regionPriority,
      probeCache
    })
  }
}

const buildAgyProviderFile: ProviderFileBuilder = async ({ proxies, regionPriority }) => {
  const { buildSparkleAgyProviderDocument, AGY_NODE_PROVIDER_FILENAME } =
    await import('./sparkleAgyProviderCore')
  const { loadSparkleAgyProbeCache } = await import('./sparkleAgyProbeCache')
  const probeCache = await loadSparkleAgyProbeCache()
  return {
    filename: AGY_NODE_PROVIDER_FILENAME,
    document: buildSparkleAgyProviderDocument({
      proxies,
      regionPriority,
      probeCache
    })
  }
}

const buildGrokProviderFile: ProviderFileBuilder = async ({ proxies }) => {
  const { buildSparkleGrokProviderDocument, GROK_NODE_PROVIDER_FILENAME } =
    await import('./sparkleGrokProviderCore')
  const { loadSparkleGrokProbeCache } = await import('./sparkleGrokProbeCache')
  const probeCache = await loadSparkleGrokProbeCache()
  return {
    filename: GROK_NODE_PROVIDER_FILENAME,
    document: buildSparkleGrokProviderDocument({
      proxies,
      probeCache
    })
  }
}

const buildGeminiProviderFile: ProviderFileBuilder = async ({ proxies, regionPriority }) => {
  const { buildSparkleGeminiProviderDocument, GEMINI_NODE_PROVIDER_FILENAME } =
    await import('./sparkleGeminiProviderCore')
  const { loadSparkleGeminiRegionCache } = await import('./sparkleGeminiRegionCache')
  const { loadGeminiStabilityLedger } = await import('./sparkleGeminiStabilityStore')
  const { loadSparkleFastDelaySnapshot } = await import('./sparkleFastLatencyOrder')
  const [regionCache, ledger, delaySnapshot] = await Promise.all([
    loadSparkleGeminiRegionCache(),
    loadGeminiStabilityLedger(),
    loadSparkleFastDelaySnapshot(proxies)
  ])
  return {
    filename: GEMINI_NODE_PROVIDER_FILENAME,
    document: buildSparkleGeminiProviderDocument({
      proxies,
      regionPriority,
      regionCache,
      delayMs: delaySnapshot,
      stability: { ledger, nowMs: Date.now() }
    })
  }
}

/** 可开关的专用 provider：关闭的组不落盘，已有文件原样保留，重新开启时直接复用。 */
const DEDICATED_PROVIDER_FILE_BUILDERS: Record<DedicatedGroupId, ProviderFileBuilder> = {
  grok: buildGrokProviderFile,
  gemini: buildGeminiProviderFile,
  mail: buildMailProviderFile,
  agy: buildAgyProviderFile
}

/** 单个 provider 的失败（探测缓存读取、磁盘写入）只影响它自己，不连累其余几份。 */
async function writeProviderFile(build: ProviderFileBuilder, input: ProviderInput): Promise<void> {
  try {
    const { filename, document } = await build(input)
    if (document.proxies.length === 0) {
      return
    }
    writeFileSync(path.join(profilesDir(), filename), stringifyYaml(document), 'utf8')
  } catch {
    // best-effort：沿用上一份文件
  }
}

export async function writeSparkleProviderFiles(
  currentProfile: MihomoConfig,
  proxySwitchPriority: string[],
  switches: DedicatedGroupSwitches
): Promise<void> {
  let input: ProviderInput
  try {
    input = {
      proxies: extractProxies(currentProfile) as unknown as ProxyRecord[],
      regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority)
    }
  } catch {
    // 读不到订阅节点：所有 provider 都沿用上一份
    return
  }
  const builders = [
    buildFastProviderFile,
    ...DEDICATED_GROUP_IDS.filter((id) => switches[id]).map(
      (id) => DEDICATED_PROVIDER_FILE_BUILDERS[id]
    )
  ]
  for (const build of builders) {
    await writeProviderFile(build, input)
  }
}
