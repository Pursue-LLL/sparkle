import dns from 'node:dns'

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/
const VPS_DNS_RESOLVE_TIMEOUT_MS = 3000

async function resolve4WithTimeout(host: string): Promise<string[]> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      dns.promises.resolve4(host),
      new Promise<string[]>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('dns resolve timeout')),
          VPS_DNS_RESOLVE_TIMEOUT_MS
        )
      })
    ])
  } catch {
    return []
  } finally {
    // 解析先完成时必须撤掉超时定时器，否则每次生成配置都会遗留一个 3 秒的挂起定时器
    clearTimeout(timer)
  }
}

export const VPS_SSH_HOST_ALIASES = ['kr-vps'] as const

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
          const resolved = await resolve4WithTimeout(server)
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

function buildDomainDirectRule(host: string): string {
  return `DOMAIN,${host},DIRECT,no-resolve`
}

/** 注释行的首段以 `#` 开头，不可能等于规则类型，因此无需单独跳过。 */
function ruleTypeAndTarget(entry: string): [type: string, target: string] {
  const [type, target = ''] = entry.split(',').map((part) => part.trim())
  return [type, target]
}

function hasDirectRuleForDomain(rules: string[], host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return rules.some((entry) => {
    const [type, target] = ruleTypeAndTarget(entry)
    return type === 'DOMAIN' && target.toLowerCase() === normalized
  })
}

/** 任意掩码长度的同 IP 规则都算已覆盖，避免重复前置。 */
function hasDirectRuleForIp(rules: string[], ip: string): boolean {
  return rules.some((entry) => {
    const [type, target] = ruleTypeAndTarget(entry)
    return type === 'IP-CIDR' && target.startsWith(`${ip}/`)
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

/**
 * Ensure outbound dials to VPS proxy servers bypass TUN/sniffer mis-routing.
 * Without this, TLS SNI (e.g. cloudflare.com) can match domain rules and loop via another proxy.
 */
export async function ensureVpsDirectBypass(
  profile: MihomoConfig,
  leafProxies: unknown[]
): Promise<void> {
  const ips = await collectVpsServerIps(leafProxies)
  const existingRules = profile.rules as string[] | undefined
  const domainRules = VPS_SSH_HOST_ALIASES.filter(
    (host) => !hasDirectRuleForDomain(existingRules ?? [], host)
  ).map(buildDomainDirectRule)

  if (domainRules.length === 0 && ips.length === 0) {
    return
  }

  const existing = existingRules ?? []
  const ipAdditions = ips.filter((ip) => !hasDirectRuleForIp(existing, ip)).map(buildDirectRule)
  Reflect.set(profile, 'rules', [...domainRules, ...ipAdditions, ...existing])

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
