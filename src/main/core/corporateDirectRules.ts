const CORPORATE_DIRECT_RULES = [
  'DOMAIN,gitlab.staff.xdf.cn,DIRECT',
  'DOMAIN-SUFFIX,staff.xdf.cn,DIRECT',
  'DOMAIN-SUFFIX,neibu.koolearn.com,DIRECT'
] as const

/** Real DNS for neibu hosts — fake-ip breaks SSO/API TLS on *.neibu.koolearn.com. */
export const CORPORATE_FAKE_IP_FILTER = ['+.neibu.koolearn.com'] as const

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
