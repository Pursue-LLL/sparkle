// [INPUT] ruleSyntax::parseRule/RULE_BUILTIN_TARGETS (POS: 规则文本解析与策略改写)
// [OUTPUT] TIER0_FAKE_IP_FILTER · TIER0_DIRECT_CN_SUFFIXES · buildTieredFakeIpFilter · ensureFakeIpRoutingIntegrity · applySnifferIntegrityPatch · sanitizeFakeIpDirectCidrRules
// [POS] fake-ip 路由一致性：fake-ip-filter 分层生成（Tier0：Cursor 域名、直连目标规则的域名与国内高频后缀；Tier1：走代理规则的域名），让这些域名拿到真实 IP；清除订阅里指向 fake-ip 段的直连 CIDR 规则，补全 sniffer；规则文本经 `ruleSyntax` 读取。

import { parseRule, RULE_BUILTIN_TARGETS } from './ruleSyntax'

/** Tier 0 — fake-ip breaks TLS/native DNS for these hosts (Cursor handoff doc). */
export const TIER0_FAKE_IP_FILTER = [
  '+.cursor.sh',
  '+.cursor.com',
  '+.cursorapi.com',
  '+.cursor-cdn.com',
  '+.workers.dev',
  'cursor.sh'
] as const

/** Tier 0 Direct — GeoSite/cn and Direct-intent hosts must receive real IPs (not 198.18.x). */
export const TIER0_DIRECT_CN_SUFFIXES = [
  '+.cn',
  '+.com.cn',
  '+.qq.com',
  '+.y.qq.com',
  '+.apple.com',
  '+.itunes.apple.com',
  '+.weixin.qq.com',
  '+.wx.qq.com'
] as const

const FAKE_IP_DIRECT_CIDR_TARGETS = ['198.18.0.0/16', '198.19.0.0/16'] as const

const DOMAIN_PATTERN = /\bDOMAIN,([^,)]+)/g
const DOMAIN_SUFFIX_PATTERN = /\bDOMAIN-SUFFIX,([^,)]+)/g

function isDirectIntentTarget(target: string): boolean {
  if (RULE_BUILTIN_TARGETS.has(target)) {
    return true
  }
  return /直连|全球拦截/.test(target)
}

/** 标签个数；mihomo 的 fake-ip-filter 无法安全表达单标签后缀（`.cn` 这类），调用方要求至少两个。 */
function suffixLabelDepth(payload: string): number {
  return payload.trim().replace(/^\./, '').split('.').filter(Boolean).length
}

function toFakeIpFilterEntry(kind: 'DOMAIN' | 'DOMAIN-SUFFIX', payload: string): string | null {
  const trimmed = payload.trim()
  if (!trimmed) {
    return null
  }

  if (kind === 'DOMAIN-SUFFIX') {
    if (suffixLabelDepth(trimmed) < 2) {
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

export function mergeFakeIpFilterEntries(
  existing: string[] | undefined,
  additions: readonly string[]
): string[] {
  const merged = new Set(existing ?? [])
  for (const entry of additions) {
    merged.add(entry)
  }
  return [...merged]
}

function isFakeIpDirectCidrRule(rule: string): boolean {
  const parsed = parseRule(rule)
  if (parsed?.head[0] !== 'IP-CIDR') {
    return false
  }

  const cidr = parsed.head[1]
  if (
    !cidr ||
    !FAKE_IP_DIRECT_CIDR_TARGETS.includes(cidr as (typeof FAKE_IP_DIRECT_CIDR_TARGETS)[number])
  ) {
    return false
  }

  // Under fake-ip, 198.18/198.19 CIDR rules always create dial loops — remove regardless of outbound name
  // (subscription rules often use emoji group names like "🎯 Direct", not literal DIRECT).
  return true
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

/** Tier 0 Direct — suffixes from Direct-intent rules + cn high-frequency suffixes. */
export function collectTier0DirectFakeIpFilterEntries(rules: string[] | undefined): string[] {
  const entries = new Set<string>(TIER0_DIRECT_CN_SUFFIXES)
  if (!rules?.length) {
    return [...entries].sort()
  }

  for (const rule of rules) {
    const target = parseRule(rule)?.policy
    if (!target || !isDirectIntentTarget(target)) {
      continue
    }
    for (const entry of collectDomainEntries(rule)) {
      entries.add(entry)
    }
  }

  return [...entries].sort()
}

/** Tier 1 — selective suffixes from proxy-intent rules (Type B fallback, not bulk dump). */
export function collectTier1FakeIpFilterEntries(rules: string[] | undefined): string[] {
  if (!rules?.length) {
    return []
  }

  const entries = new Set<string>()

  for (const rule of rules) {
    const target = parseRule(rule)?.policy
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
  const tier0Cursor = [...TIER0_FAKE_IP_FILTER]
  const tier0Direct = collectTier0DirectFakeIpFilterEntries(options.rules)
  const tier1 = options.includeTier1 === false ? [] : collectTier1FakeIpFilterEntries(options.rules)
  return mergeFakeIpFilterEntries(
    mergeFakeIpFilterEntries(mergeFakeIpFilterEntries(options.existing, tier0Cursor), tier0Direct),
    tier1
  )
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
export function applySnifferIntegrityPatch(
  sniffer: MihomoSnifferConfig | undefined
): MihomoSnifferConfig {
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
    return {
      removedFakeIpCidrRules,
      fakeIpFilterCount: profile.dns?.['fake-ip-filter']?.length ?? 0
    }
  }

  const dns = profile.dns as MihomoDNSConfig
  const filter = buildTieredFakeIpFilter({
    existing: dns['fake-ip-filter'],
    rules: profile.rules as string[] | undefined,
    includeTier1: false
  })
  dns['fake-ip-filter'] = filter

  if (profile.sniffer?.enable !== false) {
    profile.sniffer = applySnifferIntegrityPatch(profile.sniffer as MihomoSnifferConfig | undefined)
  }

  return { removedFakeIpCidrRules, fakeIpFilterCount: filter.length }
}
