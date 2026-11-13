// [INPUT] autoSwitchPinRelease::releaseAutoSwitchPins (POS: 自动组固定释放接线) ·
//         mihomoApi::mihomoUpdateProxyProviders (POS: mihomo 控制器访问层) ·
//         providerConfigCore::buildBaseConfigWithProviders (POS: provider 文档与健康检查配置) ·
//         sparkleAgyProviderCore::AGY_NODE_PROVIDER_ID (POS: agy provider 与分组配置) ·
//         sparkleFastProviderCore::FAST_NODE_PROVIDER_ID (POS: sparkle-fast provider 文件生成) ·
//         sparkleGrokProviderCore::GROK_NODE_PROVIDER_ID (POS: grok provider 与快照) ·
//         sparkleMailProviderCore::MAIL_NODE_PROVIDER_ID (POS: 邮件 provider 与分组配置) ·
//         utils/dirs::mihomoWorkDir/profilesDir (POS: 应用目录与路径常量) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志) ·
//         utils/yaml::stringifyYaml (POS: YAML 解析与序列化) ·
//         vlessVisionMuxGuardCore::applyVlessVisionMuxGuard/summarizeVlessVisionMuxGuard (POS: VLESS Vision 与 mux 互斥防护) ·
//         vpsProviderSplitCore::partitionLeafProxies/resolveVpsProviderId (POS: VPS 节点拆分与 provider id)
// [OUTPUT] extractProxies · generateProxyProvider · setupProfileProviders · reloadMihomoProfileProviders · generateBaseConfigWithProvider · deleteProvider
// [POS] 订阅节点到 provider 文件的转换层：节点经 VLESS Vision 防护后拆成商用与 VPS provider 文件落盘，生成使用 provider 的基础配置，订阅刷新时让内核热重载 provider。

import { writeFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { stringifyYaml } from '../utils/yaml'
import { mihomoWorkDir, profilesDir } from '../utils/dirs'
import { mihomoUpdateProxyProviders } from './mihomoApi'

/**
 * proxy-provider 文件绝对路径（读写磁盘用）
 */
function getProviderFilePath(profileId: string): string {
  return path.join(profilesDir(), `${profileId}-proxies.yaml`)
}

/**
 * 写入 mihomo 配置的相对路径，避免 Application Support 空格导致 YAML 断行
 */
function getProviderConfigPath(profileId: string): string {
  return path.relative(mihomoWorkDir(), getProviderFilePath(profileId))
}

import { applyVlessVisionMuxGuard, summarizeVlessVisionMuxGuard } from './vlessVisionMuxGuardCore'
import { partitionLeafProxies, resolveVpsProviderId } from './vpsProviderSplitCore'
import { buildBaseConfigWithProviders } from './providerConfigCore'
import { FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import { MAIL_NODE_PROVIDER_ID } from './sparkleMailProviderCore'
import { AGY_NODE_PROVIDER_ID } from './sparkleAgyProviderCore'
import { GEMINI_NODE_PROVIDER_ID } from './sparkleGeminiProviderCore'
import { GROK_NODE_PROVIDER_ID } from './sparkleGrokProviderCore'
import { appendAppLog } from '../utils/log'

export { resolveVpsProviderId, partitionLeafProxies } from './vpsProviderSplitCore'

/** 从订阅配置中提取 proxies，并拆分为商业节点与自建 VPS 节点。 */
export function extractProxies(config: MihomoConfig): unknown[] {
  const stabilized = applyVlessVisionMuxGuard(config.proxies || [])
  const { commercial, vps } = partitionLeafProxies(stabilized)
  return [...commercial, ...vps]
}

async function logVlessVisionMuxGuard(proxies: unknown[]): Promise<void> {
  const summary = summarizeVlessVisionMuxGuard(proxies)
  if (summary.visionNodeCount === 0) {
    return
  }
  const nodeList = summary.visionNodeNames.join(',')
  await appendAppLog(
    `[Provider]: vless_vision_mux_guard vision=${summary.visionNodeCount} stripped_multiplex=${summary.strippedMultiplexCount} ensured_smux_off=${summary.ensuredSmuxOffCount} nodes=[${nodeList}]\n`
  )
}

/**
 * 生成 proxy-provider 配置文件
 */
export async function generateProxyProvider(
  profileId: string,
  proxies: unknown[]
): Promise<string> {
  const guardedProxies = applyVlessVisionMuxGuard(proxies)
  const providerConfig = {
    proxies: guardedProxies
  }

  const filePath = getProviderFilePath(profileId)
  await writeFile(filePath, stringifyYaml(providerConfig), 'utf-8')
  return filePath
}

async function removeProviderFile(profileId: string): Promise<void> {
  const filePath = getProviderFilePath(profileId)
  if (existsSync(filePath)) {
    await rm(filePath)
  }
}

/**
 * Write commercial + optional VPS provider files for a profile.
 */
export async function setupProfileProviders(
  profileId: string,
  proxies: unknown[]
): Promise<{ commercial: unknown[]; vps: unknown[] }> {
  const { commercial, vps } = partitionLeafProxies(proxies)
  if (vps.length === 0) {
    await generateProxyProvider(profileId, proxies)
    await removeProviderFile(resolveVpsProviderId(profileId))
    return { commercial: proxies, vps: [] }
  }

  await generateProxyProvider(profileId, commercial)
  await generateProxyProvider(resolveVpsProviderId(profileId), vps)
  await logVlessVisionMuxGuard(vps)
  return { commercial, vps }
}

/** 热刷新 proxy-provider 节点文件（订阅主 / 可选 VPS / sparkle-*），随后释放因节点变动成为孤儿的自动组固定。 */
export async function reloadMihomoProfileProviders(
  profileId: string,
  hasVpsProvider: boolean
): Promise<void> {
  await mihomoUpdateProxyProviders(profileId)
  if (hasVpsProvider) {
    await mihomoUpdateProxyProviders(resolveVpsProviderId(profileId))
  }
  try {
    await mihomoUpdateProxyProviders(FAST_NODE_PROVIDER_ID)
  } catch {
    // sparkle-fast 未启用时不阻断主订阅 provider 热重载
  }
  try {
    await mihomoUpdateProxyProviders(MAIL_NODE_PROVIDER_ID)
  } catch {
    // sparkle-mail 未启用时不阻断主订阅 provider 热重载
  }
  try {
    await mihomoUpdateProxyProviders(AGY_NODE_PROVIDER_ID)
  } catch {
    // sparkle-agy 未启用时不阻断主订阅 provider 热重载
  }
  try {
    await mihomoUpdateProxyProviders(GROK_NODE_PROVIDER_ID)
  } catch {
    // sparkle-grok 未启用时不阻断主订阅 provider 热重载
  }
  try {
    await mihomoUpdateProxyProviders(GEMINI_NODE_PROVIDER_ID)
  } catch {
    // gemini专用 未启用时不阻断主订阅 provider 热重载
  }
  const { releaseAutoSwitchPins } = await import('./autoSwitchPinRelease')
  await releaseAutoSwitchPins('orphans')
}

/**
 * 生成引用 proxy-provider 的基础配置
 * rules 保持原样不动，仅将 proxies 移至 proxy-provider
 */
export function generateBaseConfigWithProvider(
  originalConfig: MihomoConfig,
  profileId: string,
  healthCheck?: {
    enable: boolean
    url?: string
    interval?: number
  }
): MihomoConfig {
  return buildBaseConfigWithProviders(originalConfig, profileId, getProviderConfigPath, healthCheck)
}

/**
 * 删除 provider 文件
 */
export async function deleteProvider(profileId: string): Promise<void> {
  const proxiesPath = getProviderFilePath(profileId)
  const vpsProxiesPath = getProviderFilePath(resolveVpsProviderId(profileId))

  if (existsSync(proxiesPath)) {
    await rm(proxiesPath)
  }
  if (existsSync(vpsProxiesPath)) {
    await rm(vpsProxiesPath)
  }
}
