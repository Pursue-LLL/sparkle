const OVERSEAS_FALLBACK = [
  'tls://223.5.5.5',
  'tls://1.1.1.1',
  'https://1.1.1.1/dns-query',
  'https://8.8.8.8/dns-query',
  'https://dns.google/dns-query'
] as const

const FALLBACK_FILTER_IPCIDR = [
  '240.0.0.0/4',
  '0.0.0.0/32',
  /** GFW DNS pollution sink (Twitter/Facebook-style fake IPs reused for OpenAI/Google). */
  '128.242.0.0/16',
  '185.45.0.0/16',
  '31.13.0.0/16',
  '208.31.0.0/16',
  '108.160.0.0/16',
  '104.244.0.0/16',
  '157.240.0.0/16'
] as const

/** Domains where geoip/ipcidr fallback is insufficient — keep list minimal. */
const FALLBACK_FILTER_DOMAINS = [
  '+.google.com',
  '+.facebook.com',
  '+.youtube.com',
  '+.twitter.com',
  '+.github.com'
] as const

function mergeStringList(
  existing: string[] | undefined,
  defaults: readonly string[]
): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const item of [...(existing ?? []), ...defaults]) {
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    merged.push(trimmed)
  }
  return merged
}

function prependStringList(
  preferred: readonly string[],
  existing: string[] | undefined
): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const item of [...preferred, ...(existing ?? [])]) {
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    merged.push(trimmed)
  }
  return merged
}

const UDP_BOOTSTRAP_NAMESERVERS = ['223.5.5.5', '1.1.1.1'] as const
const TLS_BOOTSTRAP_NAMESERVERS = ['tls://223.5.5.5', 'tls://1.1.1.1'] as const

/** nameserver-policy bypasses fallback; strip overseas domains from subscription overlays. */
const STRIP_NAMESERVER_POLICY_DOMAINS = [
  '+.google.com',
  '+.googleapis.com',
  '+.gstatic.com',
  '+.googlevideo.com',
  '+.openai.com',
  '+.chatgpt.com',
  '+.oaistatic.com',
  '+.oaiusercontent.com',
  '+.auth0.openai.com'
] as const

function stripPollutionSensitiveNameserverPolicy(profile: MihomoConfig): void {
  const policy = profile.dns?.['nameserver-policy'] as Record<string, string[]> | undefined
  if (!policy) {
    return
  }
  for (const domain of STRIP_NAMESERVER_POLICY_DOMAINS) {
    delete policy[domain]
  }
  if (Object.keys(policy).length === 0) {
    delete (profile.dns as MihomoDNSConfig)['nameserver-policy']
  }
}

function isDoHOnly(nameservers: string[] | undefined): boolean {
  if (!nameservers?.length) {
    return true
  }
  return nameservers.every(
    (entry) => entry.startsWith('https://') || entry.startsWith('http://')
  )
}

/** DoH bootstrap can fail under TUN; prepend UDP/TLS resolvers for reliable anti-pollution. */
export function ensureDnsBootstrapResilience(profile: MihomoConfig): void {
  if (!profile.dns?.enable) {
    return
  }

  const dns = profile.dns as MihomoDNSConfig

  if (isDoHOnly(dns['default-nameserver'])) {
    dns['default-nameserver'] = prependStringList(UDP_BOOTSTRAP_NAMESERVERS, dns['default-nameserver'])
  }

  if (isDoHOnly(dns.nameserver)) {
    dns.nameserver = prependStringList(TLS_BOOTSTRAP_NAMESERVERS, dns.nameserver)
  } else if (dns.nameserver?.length) {
    dns.nameserver = dns.nameserver.filter(
      (entry) => !entry.startsWith('https://') && !entry.startsWith('http://')
    )
  }

  if (isDoHOnly(dns['proxy-server-nameserver'])) {
    dns['proxy-server-nameserver'] = prependStringList(
      [...UDP_BOOTSTRAP_NAMESERVERS, 'tls://223.5.5.5'],
      dns['proxy-server-nameserver']
    )
  }
}

/** Preserve subscription fallback DNS; inject geoip-based anti-pollution when missing. */
export function ensureDnsFallbackIntegrity(profile: MihomoConfig): void {
  if (!profile.dns?.enable) {
    return
  }

  ensureDnsBootstrapResilience(profile)
  stripPollutionSensitiveNameserverPolicy(profile)

  const dns = profile.dns as MihomoDNSConfig

  if (!dns.fallback?.length) {
    dns.fallback = [...OVERSEAS_FALLBACK]
  }

  const existingFilter = (dns['fallback-filter'] ?? {}) as NonNullable<
    MihomoDNSConfig['fallback-filter']
  >
  dns['fallback-filter'] = {
    ...existingFilter,
    /** Overseas CDN IPs are valid for OpenAI/Google; ipcidr catches fake pollution only. */
    geoip: existingFilter.geoip ?? false,
    ipcidr: mergeStringList(existingFilter.ipcidr, FALLBACK_FILTER_IPCIDR),
    domain: mergeStringList(existingFilter.domain, FALLBACK_FILTER_DOMAINS)
  }
}

/** Prevent DNS/connection leak when TUN is enabled (subscription default). */
export function ensureTunStrictRoute(profile: MihomoConfig): void {
  if (!profile.tun?.enable) {
    return
  }
  const tun = profile.tun as MihomoTunConfig
  tun['strict-route'] = true
}
