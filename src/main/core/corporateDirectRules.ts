const CORPORATE_DIRECT_RULES = [
  'DOMAIN,gitlab.staff.xdf.cn,DIRECT',
  'DOMAIN-SUFFIX,staff.xdf.cn,DIRECT',
  'DOMAIN-SUFFIX,staff.neworiental.org,DIRECT',
  'DOMAIN-SUFFIX,koolearn.com,DIRECT',
  'DOMAIN-SUFFIX,neibu.koolearn.com,DIRECT',
  // macOS search-domain appends staff.neworiental.org; SUFFIX alone misses those FQDNs.
  'DOMAIN-KEYWORD,neibu.koolearn.com,DIRECT'
] as const

/** Intranet DNS — office DHCP servers (Sparkle TUN replaces system DNS with 223.5.5.5). */
export const CORPORATE_NAMESERVER_POLICY = {
  '+.koolearn.com': ['10.200.150.212', '10.200.150.211'],
  '+.neibu.koolearn.com': ['10.200.150.212', '10.200.150.211'],
  '+.staff.neworiental.org': ['10.200.150.212', '10.200.150.211'],
  '+.staff.xdf.cn': ['10.200.150.212', '10.200.150.211']
} as const satisfies Record<string, readonly string[]>

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

/** Route corporate domains through macOS system DNS (VPN/internal search-domain aware). */
export function ensureCorporateDnsPolicy(profile: MihomoConfig): void {
  if (profile.dns?.enable !== true) {
    return
  }

  const dns = profile.dns as MihomoDNSConfig
  const existing = {
    ...((dns['nameserver-policy'] as Record<string, string[]> | undefined) ?? {})
  }

  for (const [domain, servers] of Object.entries(CORPORATE_NAMESERVER_POLICY)) {
    if (!(domain in existing)) {
      existing[domain] = [...servers]
    }
  }

  dns['nameserver-policy'] = existing
}
