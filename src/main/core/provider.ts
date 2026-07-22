import { writeFile, rm, rename } from 'fs/promises'
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

/**
 * 备份 provider 文件
 */
async function backupProvider(profileId: string): Promise<void> {
  const filePath = getProviderFilePath(profileId)
  const backupPath = `${filePath}.bak`
  if (existsSync(filePath)) {
    await rename(filePath, backupPath)
  }
}

/**
 * 恢复 provider 文件
 */
async function restoreProvider(profileId: string): Promise<void> {
  const filePath = getProviderFilePath(profileId)
  const backupPath = `${filePath}.bak`
  if (existsSync(backupPath)) {
    await rename(backupPath, filePath)
  }
}

/**
 * 清理备份文件
 */
async function cleanupBackup(profileId: string): Promise<void> {
  const backupPath = `${getProviderFilePath(profileId)}.bak`
  if (existsSync(backupPath)) {
    await rm(backupPath)
  }
}

/**
 * 验证 proxies 配置格式
 */
function validateProxies(proxies: unknown[]): boolean {
  if (!Array.isArray(proxies)) return false
  return proxies.every((proxy) => {
    if (typeof proxy !== 'object' || proxy === null) return false
    const p = proxy as Record<string, unknown>
    return typeof p.name === 'string' && typeof p.type === 'string'
  })
}

import { applyHysteria2ProxiesQuicStability } from './hysteria2QuicStability'
import {
  applyVlessVisionMuxGuard,
  summarizeVlessVisionMuxGuard
} from './vlessVisionMuxGuardCore'
import { partitionLeafProxies, resolveVpsProviderId } from './vpsProviderSplitCore'
import { buildBaseConfigWithProviders } from './providerConfigCore'
import { appendAppLog } from '../utils/log'

export { resolveVpsProviderId, partitionLeafProxies } from './vpsProviderSplitCore'

/**
 * 从订阅配置中提取 proxies，并对 Hysteria 2 节点注入 QUIC/TUN 稳定性参数
 */
export function extractProxies(config: MihomoConfig): unknown[] {
  const proxies = config.proxies || []
  return applyVlessVisionMuxGuard(applyHysteria2ProxiesQuicStability(proxies))
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
  await cleanupBackup(profileId)
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

/** Hot-reload mihomo proxy-provider files after disk write (commercial + optional VPS split). */
export async function reloadMihomoProfileProviders(
  profileId: string,
  hasVpsProvider: boolean
): Promise<void> {
  await mihomoUpdateProxyProviders(profileId)
  if (hasVpsProvider) {
    await mihomoUpdateProxyProviders(resolveVpsProviderId(profileId))
  }
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
  return buildBaseConfigWithProviders(
    originalConfig,
    profileId,
    getProviderConfigPath,
    healthCheck
  )
}

/**
 * 热更新 proxy-provider（不断连，不重启内核）
 */
export async function updateProvider(
  profileId: string,
  config: MihomoConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    const proxies = extractProxies(config)

    if (!validateProxies(proxies)) {
      return { success: false, error: 'Invalid proxies format' }
    }

    const { vps } = partitionLeafProxies(proxies)
    const vpsProviderId = resolveVpsProviderId(profileId)
    const backupVps =
      vps.length > 0 || existsSync(getProviderFilePath(vpsProviderId))

    await backupProvider(profileId)
    if (backupVps) {
      await backupProvider(vpsProviderId)
    }

    await setupProfileProviders(profileId, proxies)
    await reloadMihomoProfileProviders(profileId, vps.length > 0)

    await cleanupBackup(profileId)
    if (backupVps) {
      await cleanupBackup(vpsProviderId)
    }

    return { success: true }
  } catch (error) {
    const vpsProviderId = resolveVpsProviderId(profileId)
    const backupVps = existsSync(`${getProviderFilePath(vpsProviderId)}.bak`)
    await restoreProvider(profileId)
    if (backupVps) {
      await restoreProvider(vpsProviderId)
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
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

  await cleanupBackup(profileId)
  await cleanupBackup(resolveVpsProviderId(profileId))
}
