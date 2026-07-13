/** Resolve proxy-group members when mihomo omits provider leaf nodes from /proxies. */

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
      if (proxy.name && !lookup.has(proxy.name)) {
        lookup.set(proxy.name, proxy)
      }
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
