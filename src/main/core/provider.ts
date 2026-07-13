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

/**
 * 从订阅配置中提取 proxies，并对 Hysteria 2 节点注入 QUIC/TUN 稳定性参数
 */
export function extractProxies(config: MihomoConfig): unknown[] {
  const proxies = config.proxies || []
  return applyHysteria2ProxiesQuicStability(proxies)
}

/** Merge profile provider into group.use without duplicate provider IDs. */
function normalizeGroupUse(existing: string[] | undefined, profileId: string): string[] {
  const merged = existing ? [...existing] : []
  if (!merged.includes(profileId)) {
    merged.push(profileId)
  }
  return [...new Set(merged)]
}

/**
 * 生成 proxy-provider 配置文件
 */
export async function generateProxyProvider(
  profileId: string,
  proxies: unknown[]
): Promise<string> {
  const providerConfig = {
    proxies
  }

  const filePath = getProviderFilePath(profileId)
  await writeFile(filePath, stringifyYaml(providerConfig), 'utf-8')
  return filePath
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
  const baseConfig = { ...originalConfig }

  // 仅移除 proxies（通过 proxy-provider 提供），rules 保持原样
  delete baseConfig.proxies

  // 添加 proxy-providers
  if (!baseConfig['proxy-providers']) {
    baseConfig['proxy-providers'] = {}
  }
  baseConfig['proxy-providers'][profileId] = {
    type: 'file',
    path: getProviderConfigPath(profileId),
    'health-check': {
      enable: healthCheck?.enable ?? true,
      url: healthCheck?.url || 'http://www.gstatic.com/generate_204',
      interval: healthCheck?.interval || 300
    }
  }

  // 修改 proxy-groups，使用 proxy-provider
  if (baseConfig['proxy-groups']) {
    const proxyGroups = baseConfig['proxy-groups'] as any[]
    const allGroupNames = new Set(proxyGroups.map((g: any) => g.name))
    // 收集所有代理节点名，用于判断 proxies 列表中哪些是节点引用
    const proxyNames = new Set((originalConfig.proxies as any[])?.map((p: any) => p.name) || [])

    baseConfig['proxy-groups'] = proxyGroups.map((group: any) => {
      const newGroup = { ...group }

      // 判断该组是否引用了实际代理节点（而非仅引用其他组）
      const hasProxyRefs =
        newGroup.proxies &&
        Array.isArray(newGroup.proxies) &&
        newGroup.proxies.some((name: string) => proxyNames.has(name))

      if (hasProxyRefs) {
        // 引用了代理节点，需要 provider
        if (group.use && Array.isArray(group.use)) {
          newGroup.use = normalizeGroupUse(group.use, profileId)
          // 组已显式配置 use（如 override 自建节点 + 订阅 filter）：保留 leaf 节点引用
          // mihomo 支持 proxies 与 use/filter 并存
        } else {
          newGroup.use = normalizeGroupUse(undefined, profileId)
          // 纯订阅节点列表：迁移至 provider，移除 leaf 引用
          const groupRefs = newGroup.proxies.filter(
            (name: string) => allGroupNames.has(name) || !proxyNames.has(name)
          )
          if (groupRefs.length > 0) {
            newGroup.proxies = groupRefs
          } else {
            delete newGroup.proxies
          }
        }
      } else if (group.use && Array.isArray(group.use)) {
        // 已有 use 字段的组，追加 provider（去重）
        newGroup.use = normalizeGroupUse(group.use, profileId)
      }
      // 仅引用其他组的组：不添加 use，保持原样

      return newGroup
    }) as any
  }

  return baseConfig
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

    await backupProvider(profileId)
    await generateProxyProvider(profileId, proxies)
    await mihomoUpdateProxyProviders(profileId)
    await cleanupBackup(profileId)

    return { success: true }
  } catch (error) {
    await restoreProvider(profileId)

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

  if (existsSync(proxiesPath)) {
    await rm(proxiesPath)
  }

  await cleanupBackup(profileId)
}
