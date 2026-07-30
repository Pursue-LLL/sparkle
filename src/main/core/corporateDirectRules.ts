const CORPORATE_DIRECT_RULES = [
  'DOMAIN,gitlab.staff.xdf.cn,DIRECT',
  'DOMAIN-SUFFIX,staff.xdf.cn,DIRECT',
  'DOMAIN-SUFFIX,staff.neworiental.org,DIRECT',
  'DOMAIN-SUFFIX,koolearn.com,DIRECT',
  'DOMAIN-SUFFIX,neibu.koolearn.com,DIRECT',
  // macOS search-domain appends staff.neworiental.org; SUFFIX alone misses those FQDNs.
  'DOMAIN-KEYWORD,neibu.koolearn.com,DIRECT'
] as const

const CORPORATE_NAMESERVER_SUFFIXES = [
  '+.koolearn.com',
  '+.neibu.koolearn.com',
  '+.staff.neworiental.org',
  '+.staff.xdf.cn'
] as const

function hasRule(rules: string[], candidate: string): boolean {
  return rules.some((entry) => {
    const trimmed = entry.trim()
    return trimmed === candidate || trimmed.startsWith(`${candidate},`)
  })
}

/** Prepend corporate intranet hosts so they bypass proxy groups like 全球直连 → 自动选择. */
export function ensureCorporateDirectRules(profile: MihomoConfig): void {
  const existing = (profile.rules as string[] | undefined) ?? []
  const additions = CORPORATE_DIRECT_RULES.filter((rule) => !hasRule(existing, rule))
  if (additions.length === 0) {
    return
  }
  ;(profile as MihomoConfig).rules = [...additions, ...existing]
}

function applyCorporateNameserverPolicy(profile: MihomoConfig, servers: readonly string[]): void {
  const dns = profile.dns as MihomoDNSConfig
  const existing = {
    ...((dns['nameserver-policy'] as Record<string, string[]> | undefined) ?? {})
  }

  for (const suffix of CORPORATE_NAMESERVER_SUFFIXES) {
    existing[suffix] = [...servers]
  }

  dns['nameserver-policy'] = existing
}

async function resolveCorporateNameserverList(): Promise<string[]> {
  const { getAppConfig } = await import('../config')
  const { originDNS } = await getAppConfig()
  const { readDhcpPrivateDnsServers } = await import('./corporateDhcpDns')
  const { resolveCorporateNameservers } = await import('./corporateDnsCore')

  return resolveCorporateNameservers({
    originDns: originDNS,
    dhcpDns: await readDhcpPrivateDnsServers()
  })
}

/** Route corporate domains through office resolvers (originDNS → DHCP → fallback). */
export async function ensureCorporateDnsPolicy(
  profile: MihomoConfig,
  options?: { servers?: readonly string[] }
): Promise<void> {
  if (profile.dns?.enable !== true) {
    return
  }

  const servers = options?.servers ?? (await resolveCorporateNameserverList())
  applyCorporateNameserverPolicy(profile, servers)
}
