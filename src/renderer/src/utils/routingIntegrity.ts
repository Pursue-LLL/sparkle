const DIRECT_CHAIN = 'DIRECT'
const FAKE_IP_DNS_MODE = 'fake-ip'
const DOMESTIC_GEO_TAGS = new Set(['cn', 'CN', 'private'])

function isDomesticDestination(geoTags: string[] | undefined): boolean {
  if (!geoTags?.length) {
    return false
  }
  return geoTags.some((tag) => DOMESTIC_GEO_TAGS.has(tag))
}

function isLocalHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  if (!normalized) {
    return true
  }
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.internal')
  )
}

/** Detect fake-ip connections that likely violated proxy-intent routing. */
export function detectRoutingIntegrityMismatch(connection: ControllerConnectionDetail): boolean {
  const chains = connection.chains ?? []
  if (chains.length !== 1 || chains[0] !== DIRECT_CHAIN) {
    return false
  }

  if (connection.metadata.dnsMode !== FAKE_IP_DNS_MODE) {
    return false
  }

  const host = (connection.metadata.host || connection.metadata.sniffHost || '').trim()
  if (!host || isLocalHost(host)) {
    return false
  }

  if (isDomesticDestination(connection.metadata.destinationGeoIP)) {
    return false
  }

  const destinationIp = connection.metadata.destinationIP?.trim() ?? ''
  if (destinationIp.startsWith('198.18.') || destinationIp.startsWith('198.19.')) {
    return true
  }

  return (connection.metadata.destinationGeoIP?.length ?? 0) > 0
}

export function routingIntegrityMismatchHint(connection: ControllerConnectionDetail): string {
  if (!detectRoutingIntegrityMismatch(connection)) {
    return ''
  }
  return '路由一致性异常：fake-ip 下境外域名走了 DIRECT，与代理规则意图不符。请重新生成配置。'
}
