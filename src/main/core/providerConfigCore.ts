// [INPUT] vpsProviderSplitCore::partitionLeafProxies/resolveVpsProviderId/buildCommercialProviderHealthCheck/buildVpsProviderHealthCheck/rewriteVpsFilteredGroupsToDedicatedProvider (POS: VPS 节点拆分与 provider id) ·
//         sparkleFastProviderCore::FAST_NODE_PROVIDER_ID (POS: sparkle-fast provider 文件生成) ·
//         sparkleMailProviderCore::MAIL_NODE_PROVIDER_ID (POS: 邮件 provider 与分组配置) ·
//         sparkleAgyProviderCore::AGY_NODE_PROVIDER_ID (POS: agy provider 与分组配置) ·
//         sparkleGeminiProviderCore::GEMINI_NODE_PROVIDER_ID (POS: gemini provider 与分组配置) ·
//         sparkleGrokProviderCore::GROK_NODE_PROVIDER_ID (POS: grok provider 与快照) ·
//         cursorProxyGroup::DEFAULT_GENERAL_DELAY_TEST_URL/GEMINI_REACHABILITY_PROBE_URL/MAIL_DELAY_TEST_URL (POS: Sparkle 分组名常量与判定谓词) ·
//         defaultAutoSwitchProxy::AUTO_SELECT_DELAY_PROBE_URL/AUTO_SELECT_DELAY_PROBE_TIMEOUT_MS (POS: 自动选择与地区组默认配置)
// [OUTPUT] buildBaseConfigWithProviders: 订阅配置 → 按 provider 引用节点的基础配置 · ProviderHealthCheckOverride: 调用方覆盖体检开关 / 地址 / 间隔的形状
// [POS] provider 文档与健康检查配置（纯函数，无文件系统 / Electron 依赖，可直接 node:test）：商用 / VPS / `sparkle-fast` provider 始终声明，
//       mail / gemini / agy / grok 四个专用 provider 按专用组开关声明（关闭即不声明，与分组注入同一份开关），分组里的节点引用改为 `use` provider。

import {
  buildCommercialProviderHealthCheck,
  buildVpsProviderHealthCheck,
  partitionLeafProxies,
  resolveVpsProviderId,
  rewriteVpsFilteredGroupsToDedicatedProvider
} from './vpsProviderSplitCore'
import { FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import { MAIL_NODE_PROVIDER_ID } from './sparkleMailProviderCore'
import { AGY_NODE_PROVIDER_ID } from './sparkleAgyProviderCore'
import { GEMINI_NODE_PROVIDER_ID } from './sparkleGeminiProviderCore'
import { GROK_NODE_PROVIDER_ID } from './sparkleGrokProviderCore'
import {
  DEFAULT_GENERAL_DELAY_TEST_URL,
  GEMINI_REACHABILITY_PROBE_URL,
  MAIL_DELAY_TEST_URL
} from './cursorProxyGroup'
import {
  AUTO_SELECT_DELAY_PROBE_TIMEOUT_MS,
  AUTO_SELECT_DELAY_PROBE_URL
} from './defaultAutoSwitchProxy'

export interface ProviderHealthCheckOverride {
  enable: boolean
  url?: string
  interval?: number
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
 * Build mihomo proxy-provider config (no filesystem / Electron deps — testable in node:test).
 */
export function buildBaseConfigWithProviders(
  originalConfig: MihomoConfig,
  profileId: string,
  resolveProviderPath: (providerId: string) => string,
  switches: DedicatedGroupSwitches,
  healthCheck?: ProviderHealthCheckOverride
): MihomoConfig {
  const baseConfig = { ...originalConfig }

  delete baseConfig.proxies

  if (!baseConfig['proxy-providers']) {
    baseConfig['proxy-providers'] = {}
  }

  const leafProxies = (originalConfig.proxies as unknown[]) || []
  const { commercial, vps } = partitionLeafProxies(leafProxies)
  const mainProxies = vps.length > 0 ? commercial : leafProxies
  const commercialHealthCheck = buildCommercialProviderHealthCheck(mainProxies, {
    enable: healthCheck?.enable,
    interval: healthCheck?.interval
  })

  baseConfig['proxy-providers'][profileId] = {
    type: 'file',
    path: resolveProviderPath(profileId),
    'health-check': {
      enable: commercialHealthCheck.enable,
      url: healthCheck?.url || commercialHealthCheck.url,
      interval: commercialHealthCheck.interval,
      ...(commercialHealthCheck.lazy ? { lazy: true } : {})
    }
  }

  baseConfig['proxy-providers'][FAST_NODE_PROVIDER_ID] = {
    type: 'file',
    path: resolveProviderPath(FAST_NODE_PROVIDER_ID),
    'health-check': {
      enable: commercialHealthCheck.enable,
      url: AUTO_SELECT_DELAY_PROBE_URL,
      interval: commercialHealthCheck.interval,
      timeout: AUTO_SELECT_DELAY_PROBE_TIMEOUT_MS,
      lazy: true
    }
  }

  // grok / gemini / 邮件 / agy 四个专用 provider 由开关控制：关闭即不注册，
  // 对应分组同样不会注入（见 ensureCustomProxyGroups），不会出现悬空引用。
  const dedicatedHealthCheck = (url: string): Record<string, string | number | boolean> => ({
    enable: commercialHealthCheck.enable,
    url,
    interval: commercialHealthCheck.interval,
    timeout: AUTO_SELECT_DELAY_PROBE_TIMEOUT_MS,
    lazy: true
  })

  if (switches.mail) {
    baseConfig['proxy-providers'][MAIL_NODE_PROVIDER_ID] = {
      type: 'file',
      path: resolveProviderPath(MAIL_NODE_PROVIDER_ID),
      'health-check': dedicatedHealthCheck(MAIL_DELAY_TEST_URL)
    }
  }

  // gemini专用 的成员资格由 vXmutd 地区探测把关（sparkleGeminiProbe），
  // 这里的 health-check 只用轻量 204 量存活与延迟，供 fallback 顺延与面板展示。
  if (switches.gemini) {
    baseConfig['proxy-providers'][GEMINI_NODE_PROVIDER_ID] = {
      type: 'file',
      path: resolveProviderPath(GEMINI_NODE_PROVIDER_ID),
      'health-check': dedicatedHealthCheck(DEFAULT_GENERAL_DELAY_TEST_URL)
    }
  }

  // agy 组的可用性来自真实 agy 请求探测（sparkle-agy-nodes.json），
  // 这里的 health-check 只用于面板上显示延迟，不参与选路（组类型是 select）。
  if (switches.agy) {
    baseConfig['proxy-providers'][AGY_NODE_PROVIDER_ID] = {
      type: 'file',
      path: resolveProviderPath(AGY_NODE_PROVIDER_ID),
      'health-check': dedicatedHealthCheck(GEMINI_REACHABILITY_PROBE_URL)
    }
  }

  // grok 专用组是 select + 应用层探针（sparkleGrokProbe）：稳态只复核当前节点，
  // provider 不做周期体检，避免池内节点被反复全量探测（这正是"找到一个就停"的前提）。
  if (switches.grok) {
    baseConfig['proxy-providers'][GROK_NODE_PROVIDER_ID] = {
      type: 'file',
      path: resolveProviderPath(GROK_NODE_PROVIDER_ID),
      'health-check': { enable: false }
    }
  }

  if (vps.length > 0) {
    const vpsProviderId = resolveVpsProviderId(profileId)
    const vpsHealthCheck = buildVpsProviderHealthCheck({
      enable: healthCheck?.enable
    })
    baseConfig['proxy-providers'][vpsProviderId] = {
      type: 'file',
      path: resolveProviderPath(vpsProviderId),
      'health-check': {
        enable: vpsHealthCheck.enable,
        url: vpsHealthCheck.url,
        interval: vpsHealthCheck.interval,
        ...(vpsHealthCheck.lazy ? { lazy: true } : {})
      }
    }
  }

  if (baseConfig['proxy-groups']) {
    const proxyGroups = baseConfig['proxy-groups'] as {
      name: string
      proxies?: string[]
      use?: string[]
    }[]
    const allGroupNames = new Set(proxyGroups.map((group) => group.name))
    const proxyNames = new Set(
      (originalConfig.proxies as { name?: string }[])?.map((proxy) => proxy.name) || []
    )

    baseConfig['proxy-groups'] = proxyGroups.map((group) => {
      const newGroup = { ...group }

      const hasProxyRefs =
        newGroup.proxies &&
        Array.isArray(newGroup.proxies) &&
        newGroup.proxies.some((name) => proxyNames.has(name))

      if (hasProxyRefs) {
        if (group.use && Array.isArray(group.use)) {
          newGroup.use = normalizeGroupUse(group.use, profileId)
        } else {
          newGroup.use = normalizeGroupUse(undefined, profileId)
          const groupRefs = newGroup.proxies!.filter(
            (name) => allGroupNames.has(name) || !proxyNames.has(name)
          )
          if (groupRefs.length > 0) {
            newGroup.proxies = groupRefs
          } else {
            delete newGroup.proxies
          }
        }
      } else if (group.use && Array.isArray(group.use)) {
        newGroup.use = normalizeGroupUse(group.use, profileId)
      }

      return newGroup
    }) as MihomoConfig['proxy-groups']
  }

  rewriteVpsFilteredGroupsToDedicatedProvider(baseConfig, profileId, vps.length)

  return baseConfig
}
