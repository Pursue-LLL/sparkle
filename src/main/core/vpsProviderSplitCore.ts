import { CURSOR_DELAY_TEST_URL } from './cursorProxyGroup'

export const VPS_PROVIDER_ID_SUFFIX = '-vps' as const
/** VPS health-check: less frequent + lazy to avoid idle tunnel probes. */
export const VPS_PROVIDER_HEALTH_CHECK_INTERVAL_SEC = 600

export function resolveVpsProviderId(profileId: string): string {
  return `${profileId}${VPS_PROVIDER_ID_SUFFIX}`
}

export function isVpsProviderId(providerId: string): boolean {
  return providerId.endsWith(VPS_PROVIDER_ID_SUFFIX)
}

export function isVpsLeafProxy(proxy: unknown): boolean {
  if (typeof proxy !== 'object' || proxy === null) {
    return false
  }
  const record = proxy as Record<string, unknown>
  const name = record.name
  return typeof name === 'string' && /vps/i.test(name)
}

export function partitionLeafProxies(proxies: unknown[]): {
  commercial: unknown[]
  vps: unknown[]
} {
  const commercial: unknown[] = []
  const vps: unknown[] = []
  for (const proxy of proxies) {
    if (isVpsLeafProxy(proxy)) {
      vps.push(proxy)
    } else {
      commercial.push(proxy)
    }
  }
  return { commercial, vps }
}

export interface ProviderHealthCheckConfig {
  enable: boolean
  url: string
  interval: number
  lazy?: boolean
}

export function buildCommercialProviderHealthCheck(
  commercialProxies: unknown[],
  options?: { enable?: boolean; interval?: number }
): ProviderHealthCheckConfig {
  const hasVpsInBatch = commercialProxies.some(isVpsLeafProxy)
  return {
    enable: options?.enable ?? true,
    url: hasVpsInBatch ? CURSOR_DELAY_TEST_URL : 'http://www.gstatic.com/generate_204',
    interval: options?.interval ?? 300
  }
}

export function buildVpsProviderHealthCheck(
  options?: { enable?: boolean; interval?: number; lazy?: boolean }
): ProviderHealthCheckConfig {
  return {
    enable: options?.enable ?? true,
    url: CURSOR_DELAY_TEST_URL,
    interval: options?.interval ?? VPS_PROVIDER_HEALTH_CHECK_INTERVAL_SEC,
    lazy: options?.lazy ?? true
  }
}

const VPS_PROVIDER_FILTER_PATTERN = /vps/i

interface ProxyGroupWithFilter {
  name?: string
  use?: string[]
  filter?: string
  proxies?: string[]
}

/** Rewrite subscription/override groups that filter VPS on the commercial provider. */
export function rewriteVpsFilteredGroupsToDedicatedProvider(
  profile: MihomoConfig,
  profileId: string,
  vpsLeafCount: number
): boolean {
  if (vpsLeafCount <= 0) {
    return false
  }
  const groups = profile['proxy-groups'] as ProxyGroupWithFilter[] | undefined
  if (!groups?.length) {
    return false
  }

  const vpsProviderId = resolveVpsProviderId(profileId)
  let rewritten = false

  for (const group of groups) {
    const filter = group.filter?.trim()
    if (!filter || !VPS_PROVIDER_FILTER_PATTERN.test(filter)) {
      continue
    }
    group.use = [vpsProviderId]
    delete group.filter
    const proxyRefs = group.proxies?.filter((name) => VPS_PROVIDER_FILTER_PATTERN.test(name)) ?? []
    if (proxyRefs.length > 0) {
      delete group.proxies
    }
    rewritten = true
  }

  return rewritten
}
