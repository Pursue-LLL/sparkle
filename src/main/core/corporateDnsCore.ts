/** Fallback when originDNS/DHCP private resolvers are unavailable (XDF office WiFi). */
export const CORPORATE_NAMESERVER_FALLBACK = [
  '10.200.150.212',
  '10.200.150.211'
] as const

const PRIVATE_IPV4_RE =
  /^(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})$/

export function isPrivateIpv4DnsServer(value: string): boolean {
  return PRIVATE_IPV4_RE.test(value.trim())
}

/** Parse whitespace-separated DNS list from Sparkle originDNS snapshot. */
export function parsePrivateDnsServers(originDns: string | undefined): string[] {
  if (!originDns || originDns.trim() === 'Empty') {
    return []
  }

  const seen = new Set<string>()
  const servers: string[] = []
  for (const entry of originDns.trim().split(/\s+/)) {
    const trimmed = entry.trim()
    if (!trimmed || !isPrivateIpv4DnsServer(trimmed) || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    servers.push(trimmed)
  }
  return servers
}

/** Parse `ipconfig getpacket` lines: `domain_name_server (ip_mult): {a, b}`. */
export function parseDhcpDnsServersFromIpconfig(output: string): string[] {
  const match = output.match(/domain_name_server \(ip_mult\):\s*\{([^}]*)\}/i)
  if (!match?.[1]) {
    return []
  }

  const seen = new Set<string>()
  const servers: string[] = []
  for (const raw of match[1].split(',')) {
    const trimmed = raw.trim()
    if (!trimmed || !isPrivateIpv4DnsServer(trimmed) || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    servers.push(trimmed)
  }
  return servers
}

export function resolveCorporateNameservers(options: {
  originDns?: string
  dhcpDns?: string[]
}): string[] {
  const fromOrigin = parsePrivateDnsServers(options.originDns)
  if (fromOrigin.length > 0) {
    return fromOrigin
  }

  const fromDhcp = (options.dhcpDns ?? []).filter(isPrivateIpv4DnsServer)
  if (fromDhcp.length > 0) {
    return fromDhcp
  }

  return [...CORPORATE_NAMESERVER_FALLBACK]
}
