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
import { GEMINI_REACHABILITY_PROBE_URL, MAIL_DELAY_TEST_URL } from './cursorProxyGroup'
import {
  AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
  AUTO_SELECT_GEMINI_PROBE_URL
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
      url: AUTO_SELECT_GEMINI_PROBE_URL,
      interval: commercialHealthCheck.interval,
      timeout: AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
      lazy: true
    }
  }

  baseConfig['proxy-providers'][MAIL_NODE_PROVIDER_ID] = {
    type: 'file',
    path: resolveProviderPath(MAIL_NODE_PROVIDER_ID),
    'health-check': {
      enable: commercialHealthCheck.enable,
      url: MAIL_DELAY_TEST_URL,
      interval: commercialHealthCheck.interval,
      timeout: AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
      lazy: true
    }
  }

  // agy 组的可用性来自真实 agy 请求探测（sparkle-agy-nodes.json），
  // 这里的 health-check 只用于面板上显示延迟，不参与选路（组类型是 select）。
  baseConfig['proxy-providers'][AGY_NODE_PROVIDER_ID] = {
    type: 'file',
    path: resolveProviderPath(AGY_NODE_PROVIDER_ID),
    'health-check': {
      enable: commercialHealthCheck.enable,
      url: GEMINI_REACHABILITY_PROBE_URL,
      interval: commercialHealthCheck.interval,
      timeout: AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
      lazy: true
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
