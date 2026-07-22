import { buildCommercialProviderHealthCheck } from './vpsProviderSplitCore'

/**
 * @deprecated Use `partitionLeafProxies` + `buildCommercialProviderHealthCheck` /
 * `buildVpsProviderHealthCheck` so VPS leaves never share a batch provider with commercial nodes.
 */
export function resolveProviderHealthCheckUrl(proxies: unknown[]): string {
  return buildCommercialProviderHealthCheck(proxies).url
}

export { isVpsLeafProxy } from './vpsProviderSplitCore'
