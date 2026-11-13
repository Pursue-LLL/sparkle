// [INPUT] proxyProbeHistoryCore::poolProxyInstances (POS: 节点探测取数口径)
// [OUTPUT] buildProviderProxyLookup · resolveGroupMemberProxies
// [POS] 分组成员解析：内核 `/proxies` 不含 provider 叶子时，按名从 provider 汇总（同名节点的探测样本合并），都找不到则补一个占位节点。

/** Resolve proxy-group members when mihomo omits provider leaf nodes from /proxies. */

import { poolProxyInstances } from './proxyProbeHistoryCore'

/** 同名节点视为同一节点：多个 provider 里的探测样本合并，而不是只取最先出现的那份。 */
export function buildProviderProxyLookup(
  providers: ControllerProxyProviders | null | undefined
): Map<string, ControllerProxiesDetail> {
  const lookup = new Map<string, ControllerProxiesDetail>()
  const providerRecords = providers?.providers
  if (!providerRecords) {
    return lookup
  }

  for (const provider of Object.values(providerRecords)) {
    for (const proxy of provider.proxies ?? []) {
      if (!proxy.name) {
        continue
      }
      const existing = lookup.get(proxy.name)
      lookup.set(proxy.name, existing ? poolProxyInstances(existing, proxy) : proxy)
    }
  }
  return lookup
}

function buildFallbackProxyDetail(name: string): ControllerProxiesDetail {
  return {
    name,
    type: 'Unknown',
    alive: true,
    history: [],
    extra: {},
    id: name,
    tfo: false,
    udp: true,
    xudp: false,
    mptcp: false,
    smux: false,
    uot: false,
    'dialer-proxy': '',
    interface: '',
    'routing-mark': 0
  }
}

export function resolveGroupMemberProxies(
  memberNames: string[],
  proxiesDict: Record<string, ControllerProxiesDetail | ControllerGroupDetail>,
  providerLookup: Map<string, ControllerProxiesDetail>
): (ControllerProxiesDetail | ControllerGroupDetail)[] {
  return memberNames.map((name) => {
    const fromDict = proxiesDict[name]
    if (fromDict) {
      return fromDict
    }
    const fromProvider = providerLookup.get(name)
    if (fromProvider) {
      return fromProvider
    }
    return buildFallbackProxyDetail(name)
  })
}
