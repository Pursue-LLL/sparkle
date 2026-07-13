import dns from 'node:dns'

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/

function parseIpv4(ip: string): number[] | null {
  if (!IPV4_PATTERN.test(ip)) {
    return null
  }
  const octets = ip.split('.').map((part) => Number(part))
  if (octets.some((octet) => octet > 255)) {
    return null
  }
  return octets
}

export function isPublicIpv4(ip: string): boolean {
  const octets = parseIpv4(ip)
  if (!octets) {
    return false
  }
  const [a, b] = octets
  if (a === 10 || a === 127) {
    return false
  }
  if (a === 192 && b === 168) {
    return false
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false
  }
  if (a === 169 && b === 254) {
    return false
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return false
  }
  if (a === 0 || a >= 224) {
    return false
  }
  return true
}

function isVpsLeafProxy(proxy: Record<string, unknown>): boolean {
  const name = typeof proxy.name === 'string' ? proxy.name : ''
  const type = typeof proxy.type === 'string' ? proxy.type : ''
  return /vps/i.test(name) || ['hysteria2', 'tuic', 'vless'].includes(type.toLowerCase())
}

/** Collect public IPv4 server addresses from VPS leaf proxies (override / provider). */
export async function collectVpsServerIps(proxies: unknown[]): Promise<string[]> {
  const ips = new Set<string>()
  for (const raw of proxies) {
    if (typeof raw !== 'object' || raw === null) {
      continue
    }
    const proxy = raw as Record<string, unknown>
    if (!isVpsLeafProxy(proxy)) {
      continue
    }
    const server = proxy.server
    if (typeof server === 'string') {
      if (IPV4_PATTERN.test(server)) {
        if (isPublicIpv4(server)) {
          ips.add(server)
        }
      } else {
        try {
          const resolved = await dns.promises.resolve4(server)
          for (const ip of resolved) {
            if (isPublicIpv4(ip)) {
              ips.add(ip)
            }
          }
        } catch {
          // ignore DNS resolution error
        }
      }
    }
  }
  return [...ips].sort()
}

function buildDirectRule(ip: string): string {
  return `IP-CIDR,${ip}/32,DIRECT,no-resolve`
}

function hasDirectRuleForIp(rules: string[], ip: string): boolean {
  const cidr = `${ip}/32`
  return rules.some((entry) => {
    const trimmed = entry.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return false
    }
    const parts = trimmed.split(',')
    if (parts[0]?.trim() !== 'IP-CIDR') {
      return false
    }
    const target = parts[1]?.trim() ?? ''
    return target === cidr || target.startsWith(`${ip}/`)
  })
}

function prependUnique(values: string[] | undefined, additions: string[]): string[] {
  const merged = [...additions]
  for (const value of values ?? []) {
    if (!merged.includes(value)) {
      merged.push(value)
    }
  }
  return merged
}

function prependDirectRules(rules: string[] | undefined, ips: string[]): string[] {
  const existing = rules ?? []
  const additions = ips
    .filter((ip) => !hasDirectRuleForIp(existing, ip))
    .map(buildDirectRule)
  return [...additions, ...existing]
}

/**
 * Ensure outbound dials to VPS proxy servers bypass TUN/sniffer mis-routing.
 * Without this, TLS SNI (e.g. cloudflare.com) can match domain rules and loop via another proxy.
 */
export async function ensureVpsDirectBypass(profile: MihomoConfig, leafProxies: unknown[]): Promise<void> {
  const ips = await collectVpsServerIps(leafProxies)
  if (ips.length === 0) {
    return
  }

  ;(profile as any).rules = prependDirectRules(profile.rules as string[] | undefined, ips)

  if (profile.tun?.enable) {
    const tun = profile.tun as MihomoTunConfig
    const cidrs = ips.map((ip) => `${ip}/32`)
    tun['route-exclude-address'] = prependUnique(tun['route-exclude-address'], cidrs)
  }

  if (profile.sniffer?.enable) {
    const sniffer = profile.sniffer as MihomoSnifferConfig
    const cidrs = ips.map((ip) => `${ip}/32`)
    sniffer['skip-dst-address'] = prependUnique(sniffer['skip-dst-address'], cidrs)
  }
}
