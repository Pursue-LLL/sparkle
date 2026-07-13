export const DEFAULT_REGION_PRIORITY = ['新加坡', '日本', '台湾', '韩国', '美国'] as const

export const BLOCKED_REGION_KEYWORDS = ['香港', 'hongkong', 'hong kong'] as const

const REGION_PROVIDER_FILTERS: Readonly<Record<string, string>> = {
  新加坡: '新加坡|(?i)\\bSG\\b|singapore',
  日本: '日本|(?i)\\bJP\\b|japan',
  台湾: '台湾|(?i)\\bTW\\b|taiwan',
  韩国: '韩国|(?i)\\bKR\\b|korea',
  美国: '美国|(?i)\\bUS\\b|(?i)\\bUSA\\b|united\\s*states'
}

const REGION_KEYWORD_ALIASES: Readonly<Record<string, readonly string[]>> = {
  新加坡: ['新加坡', 'sg', 'singapore', '🇸🇬'],
  日本: ['日本', 'jp', 'japan', '🇯🇵'],
  台湾: ['台湾', 'tw', 'taiwan', '🇹🇼'],
  韩国: ['韩国', 'kr', 'korea', '🇰🇷'],
  美国: ['美国', 'us', 'usa', 'united states', '🇺🇸']
}

const LATIN_REGION_CODES: Readonly<Record<string, keyof typeof REGION_KEYWORD_ALIASES>> = {
  sg: '新加坡',
  singapore: '新加坡',
  jp: '日本',
  japan: '日本',
  tw: '台湾',
  taiwan: '台湾',
  kr: '韩国',
  korea: '韩国',
  us: '美国',
  usa: '美国',
  'united states': '美国'
}

const SHORT_ASCII_REGION_CODES = new Set(['sg', 'jp', 'tw', 'kr', 'us', 'usa'])

/** Headline Chinese region markers; null = known non-default region (exclude from auto groups). */
const EXPLICIT_HEADLINE_REGIONS: Readonly<
  Record<string, keyof typeof REGION_KEYWORD_ALIASES | null>
> = {
  马来西亚: null,
  香港: null,
  新加坡: '新加坡',
  日本: '日本',
  台湾: '台湾',
  韩国: '韩国',
  美国: '美国'
}

function extractNodeHeadline(nodeName: string): string {
  const pipeIndex = nodeName.indexOf('|')
  return (pipeIndex >= 0 ? nodeName.slice(0, pipeIndex) : nodeName).trim()
}

function resolveExplicitHeadlineRegion(
  headline: string
): keyof typeof REGION_KEYWORD_ALIASES | null | undefined {
  let resolved: keyof typeof REGION_KEYWORD_ALIASES | null | undefined = undefined
  for (const [marker, canonical] of Object.entries(EXPLICIT_HEADLINE_REGIONS)) {
    if (!headline.includes(marker)) {
      continue
    }
    if (resolved !== undefined) {
      continue
    }
    resolved = canonical
  }
  return resolved
}

function resolveCanonicalRegionKey(region: string): string | undefined {
  const trimmed = region.trim()
  if (REGION_KEYWORD_ALIASES[trimmed]) {
    return trimmed
  }
  return LATIN_REGION_CODES[trimmed.toLowerCase()]
}

function keywordMatchesNode(nodeName: string, keyword: string): boolean {
  const lowerKeyword = keyword.toLowerCase()
  const lowerNode = nodeName.toLowerCase()

  if (SHORT_ASCII_REGION_CODES.has(lowerKeyword)) {
    const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(lowerNode)
  }

  if (/[\u{1F1E6}-\u{1F1FF}]/u.test(keyword)) {
    return nodeName.includes(keyword)
  }

  return lowerNode.includes(lowerKeyword)
}

export function normalizeRegionPriority(priorityList: string[]): string[] {
  const filtered = priorityList.filter(
    (priority) =>
      !BLOCKED_REGION_KEYWORDS.some((blocked) =>
        priority.toLowerCase().includes(blocked.toLowerCase())
      )
  )
  return filtered.length > 0 ? filtered : [...DEFAULT_REGION_PRIORITY]
}

/** Preserve user order; append any default regions missing from persisted config. */
export function resolveEffectiveRegionPriority(priorityList: string[]): string[] {
  const normalized = normalizeRegionPriority(priorityList)
  const merged = [...normalized]
  for (const region of DEFAULT_REGION_PRIORITY) {
    if (!merged.includes(region)) {
      merged.push(region)
    }
  }
  return merged
}

export function extractRegionKeywords(region: string): string[] {
  const canonical = resolveCanonicalRegionKey(region)
  if (canonical) {
    return [...REGION_KEYWORD_ALIASES[canonical]]
  }

  const keywords = new Set<string>()
  for (const segment of region.match(/[\u4e00-\u9fff]+/g) ?? []) {
    keywords.add(segment.toLowerCase())
  }

  const lower = region.toLowerCase()
  for (const keyword of [
    'singapore',
    'taiwan',
    'japan',
    'korea',
    'united states',
    'usa',
    'sg',
    'tw',
    'jp',
    'kr',
    'us'
  ]) {
    if (lower.includes(keyword)) {
      keywords.add(keyword)
    }
  }

  return [...keywords]
}

export function nodeMatchesRegion(nodeName: string, region: string): boolean {
  const headline = extractNodeHeadline(nodeName)
  const explicitRegion = resolveExplicitHeadlineRegion(headline)

  if (explicitRegion !== undefined) {
    if (explicitRegion === null) {
      return false
    }
    const canonicalTarget = resolveCanonicalRegionKey(region)
    return explicitRegion === (canonicalTarget ?? region)
  }

  const keywords = extractRegionKeywords(region)

  if (keywords.length === 0) {
    const normalizedHeadline = headline.toLowerCase()
    const normalizedRegion = region.toLowerCase()
    return (
      normalizedHeadline.includes(normalizedRegion) ||
      normalizedRegion.includes(normalizedHeadline)
    )
  }

  return keywords.some((keyword) => keywordMatchesNode(headline, keyword))
}

export function buildRegionProviderFilter(region: string): string | undefined {
  const canonical = resolveCanonicalRegionKey(region)
  if (canonical && REGION_PROVIDER_FILTERS[canonical]) {
    return REGION_PROVIDER_FILTERS[canonical]
  }

  const keywords = extractRegionKeywords(region)
  if (keywords.length === 0) {
    return undefined
  }

  return keywords
    .filter((keyword) => !/[\u{1F1E6}-\u{1F1FF}]/u.test(keyword))
    .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
}
