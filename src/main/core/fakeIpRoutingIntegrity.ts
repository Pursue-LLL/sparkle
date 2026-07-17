import { CORPORATE_FAKE_IP_FILTER } from './corporateDirectRules'

const RULE_BUILTIN_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'DNS', 'NOOP'])
const RULE_MODIFIERS = new Set(['no-resolve'])

/** Tier 0 — fake-ip breaks TLS/native DNS for these hosts (Cursor handoff doc). */
export const TIER0_FAKE_IP_FILTER = [
  '+.cursor.sh',
  '+.cursor.com',
  '+.cursorapi.com',
  '+.cursor-cdn.com',
  '+.workers.dev',
  'cursor.sh'
] as const

/** Legacy alias — use TIER0_FAKE_IP_FILTER. */
export const CURSOR_FAKE_IP_FILTER = TIER0_FAKE_IP_FILTER

const FAKE_IP_DIRECT_CIDR_TARGETS = ['198.18.0.0/16', '198.19.0.0/16'] as const

/** Mihomo fake-ip-filter cannot safely represent single-label public suffixes. */
const TLD_ONLY_SUFFIX = /^\.[a-z0-9-]{2,63}$/i

const DOMAIN_PATTERN = /\bDOMAIN,([^,)]+)/g
const DOMAIN_SUFFIX_PATTERN = /\bDOMAIN-SUFFIX,([^,)]+)/g

function isDirectIntentTarget(target: string): boolean {
  if (RULE_BUILTIN_TARGETS.has(target)) {
    return true
  }
  return /直连|全球拦截/.test(target)
}

function stripRuleModifiers(parts: string[]): string[] {
  const copy = [...parts]
  while (copy.length > 0 && RULE_MODIFIERS.has(copy[copy.length - 1].trim())) {
    copy.pop()
  }
  return copy
}

function resolveRuleTarget(rule: string): string | undefined {
  const normalized = rule.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.startsWith('#')) {
    return undefined
  }

  const parts = stripRuleModifiers(normalized.split(','))
  if (parts.length < 3) {
    return undefined
  }
  return parts[parts.length - 1]?.trim()
}

function isTldOnlySuffix(payload: string): boolean {
  return TLD_ONLY_SUFFIX.test(payload.trim())
}

function suffixLabelDepth(payload: string): number {
  const trimmed = payload.trim().replace(/^\./, '')
  if (!trimmed) {
    return 0
  }
  return trimmed.split('.').filter(Boolean).length
}

function toFakeIpFilterEntry(kind: 'DOMAIN' | 'DOMAIN-SUFFIX', payload: string): string | null {
  const trimmed = payload.trim()
  if (!trimmed || trimmed === '.') {
    return null
  }

  if (kind === 'DOMAIN-SUFFIX') {
    if (isTldOnlySuffix(trimmed) || suffixLabelDepth(trimmed) < 2) {
      return null
    }
    if (trimmed.startsWith('.')) {
      return `+${trimmed}`
    }
    return `+.${trimmed}`
  }

  if (trimmed.startsWith('.')) {
    return suffixLabelDepth(trimmed) >= 2 ? `+${trimmed}` : null
  }
  return trimmed
}

function collectDomainEntries(rule: string): string[] {
  const entries: string[] = []

  for (const match of rule.matchAll(DOMAIN_PATTERN)) {
    const payload = match[1]?.trim()
    if (!payload) {
      continue
    }
    const entry = toFakeIpFilterEntry('DOMAIN', payload)
    if (entry) {
      entries.push(entry)
    }
  }

  for (const match of rule.matchAll(DOMAIN_SUFFIX_PATTERN)) {
    const payload = match[1]?.trim()
    if (!payload) {
      continue
    }
    const entry = toFakeIpFilterEntry('DOMAIN-SUFFIX', payload)
    if (entry) {
      entries.push(entry)
    }
  }

  return entries
}

export function mergeFakeIpFilterEntries(existing: string[] | undefined, additions: readonly string[]): string[] {
  const merged = new Set(existing ?? [])
  for (const entry of additions) {
    merged.add(entry)
  }
  return [...merged]
}

function isFakeIpDirectCidrRule(rule: string): boolean {
  const normalized = rule.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.startsWith('#')) {
    return false
  }

  const parts = stripRuleModifiers(normalized.split(','))
  if (parts.length < 3 || parts[0]?.trim() !== 'IP-CIDR') {
    return false
  }

  const cidr = parts[1]?.trim()
  if (!cidr || !FAKE_IP_DIRECT_CIDR_TARGETS.includes(cidr as (typeof FAKE_IP_DIRECT_CIDR_TARGETS)[number])) {
    return false
  }

  const target = parts[2]?.trim() ?? ''
  return target === 'DIRECT' || /直连/.test(target)
}

function isFakeIpRoutingActive(profile: MihomoConfig): boolean {
  if (profile.dns?.enable !== true) {
    return false
  }
  if (profile.dns['enhanced-mode'] !== 'fake-ip') {
    return false
  }
  return profile.profile?.['store-fake-ip'] !== false
}

/** Tier 1 — selective suffixes from proxy-intent rules (Type B fallback, not bulk dump). */
export function collectTier1FakeIpFilterEntries(rules: string[] | undefined): string[] {
  if (!rules?.length) {
    return []
  }

  const entries = new Set<string>()

  for (const rule of rules) {
    const target = resolveRuleTarget(rule)
    if (!target || isDirectIntentTarget(target)) {
      continue
    }

    for (const entry of collectDomainEntries(rule)) {
      entries.add(entry)
    }
  }

  return [...entries].sort()
}

export function buildTieredFakeIpFilter(options: {
  existing?: string[]
  rules?: string[]
  includeTier1?: boolean
}): string[] {
  const tier0 = [...TIER0_FAKE_IP_FILTER, ...CORPORATE_FAKE_IP_FILTER]
  const tier1 = options.includeTier1 === false ? [] : collectTier1FakeIpFilterEntries(options.rules)
  return mergeFakeIpFilterEntries(mergeFakeIpFilterEntries(options.existing, tier0), tier1)
}

/** Layer 1 — remove legacy fake-ip CIDR → DIRECT trap from subscription rules. */
export function sanitizeFakeIpDirectCidrRules(profile: MihomoConfig): number {
  if (!isFakeIpRoutingActive(profile)) {
    return 0
  }

  const rules = profile.rules as string[] | undefined
  if (!rules?.length) {
    return 0
  }

  const next = rules.filter((rule) => !isFakeIpDirectCidrRule(rule))
  const removed = rules.length - next.length
  if (removed > 0) {
    profile.rules = next
  }
  return removed
}

/** Layer 3 — ensure fake-ip DNS mapping is active for pure-IP connections (incl. UDP STUN). */
export function applySnifferIntegrityPatch(sniffer: MihomoSnifferConfig | undefined): MihomoSnifferConfig {
  const base = sniffer ?? {}
  return {
    ...base,
    enable: base.enable ?? true,
    'parse-pure-ip': true,
    'force-dns-mapping': true,
    'override-destination': base['override-destination'] ?? false
  }
}

/** Apply all fake-ip routing integrity layers to a runtime profile. */
export function ensureFakeIpRoutingIntegrity(profile: MihomoConfig): {
  removedFakeIpCidrRules: number
  fakeIpFilterCount: number
} {
  const removedFakeIpCidrRules = sanitizeFakeIpDirectCidrRules(profile)

  if (!isFakeIpRoutingActive(profile)) {
    return { removedFakeIpCidrRules, fakeIpFilterCount: profile.dns?.['fake-ip-filter']?.length ?? 0 }
  }

  const dns = profile.dns as MihomoDNSConfig
  dns['fake-ip-filter'] = buildTieredFakeIpFilter({
    existing: dns['fake-ip-filter'],
    includeTier1: false
  })

  if (profile.sniffer?.enable !== false) {
    profile.sniffer = applySnifferIntegrityPatch(profile.sniffer as MihomoSnifferConfig | undefined)
  }

  return {
    removedFakeIpCidrRules,
    fakeIpFilterCount: dns['fake-ip-filter']?.length ?? 0
  }
}

/** Controlled mihomo.yaml patch — Tier 0 only (no subscription rules at this layer). */
export function buildControlledFakeIpFilter(existing: string[] | undefined): string[] {
  return buildTieredFakeIpFilter({ existing, includeTier1: false })
}
