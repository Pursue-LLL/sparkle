import {
  CURSOR_2_APP_PATH_PREFIX,
  CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES,
  CURSOR_DIRECT_FALLBACK_APP_PATH_PREFIXES,
  CURSOR_NODE_SELECT_APP_PATH_PREFIXES
} from './cursorAppBundlePathsCore'
import {
  CURSOR_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  resolveCursorStableSelectorGroup,
  resolveGeneralProxySelectGroup
} from './cursorProxyGroup'
import { parseRule } from './ruleSyntax'

/** Default dedicated bundles — Cursor 主 / Latest / Cursor-2 / Cursor-3 → 🎯 Cursor 专用. */
export const DEFAULT_CURSOR_PROXY_APP_PATH_PREFIXES = CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES

/** Optional extra bundles → 🚀 节点选择 / 自动选择（默认可为空）. */
export const DEFAULT_CURSOR_NODE_SELECT_APP_PATH_PREFIXES = CURSOR_NODE_SELECT_APP_PATH_PREFIXES

/** Optional path-scoped DIRECT fallback — empty because every Cursor bundle uses Cursor 专用. */
export const DEFAULT_CURSOR_DIRECT_FALLBACK_APP_PATH_PREFIXES =
  CURSOR_DIRECT_FALLBACK_APP_PATH_PREFIXES

export {
  CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES,
  CURSOR_DIRECT_FALLBACK_APP_PATH_PREFIXES,
  CURSOR_NODE_SELECT_APP_PATH_PREFIXES,
  CURSOR_2_APP_PATH_PREFIX
}

/** Cursor Agent / Chat API hosts (HTTP/2 bidi + SSE). */
export const CURSOR_PROXY_DOMAINS = [
  'agent.api5.cursor.sh',
  'agentn.global.api5.cursor.sh',
  'agentn.global.api5lat.cursor.sh',
  'api2.cursor.sh',
  'api2geo.cursor.sh',
  'api2direct.cursor.sh',
  'api3.cursor.sh',
  'api4.cursor.sh',
  'api5.cursor.sh',
  'us-asia.gcpp.cursor.sh',
  'us-eu.gcpp.cursor.sh',
  'us-only.gcpp.cursor.sh',
  'prod.authentication.cursor.sh',
  'authenticator.cursor.sh',
  'repo42.cursor.sh',
  'downloads.cursor.com',
  'cursor-cdn.com',
  'metrics.cursor.sh',
  'cursorapi.com'
] as const

function buildAndRule(innerRules: readonly string[], mainGroup: string): string {
  const wrapped = innerRules.map((rule) => `(${rule})`).join(',')
  return `AND,(${wrapped}),${mainGroup}`
}

function pushRuleIfMissing(prefix: string[], existing: Set<string>, rule: string): void {
  if (!existing.has(rule)) {
    prefix.push(rule)
    existing.add(rule)
  }
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** mihomo PROCESS-PATH is exact-match only; bundle installs need REGEX prefix matching. */
function buildAppBundlePathMatcher(appPrefix: string): string {
  return `PROCESS-PATH-REGEX,^${escapeRegexLiteral(appPrefix)}/`
}

const CURSOR_DEDICATED_GROUP_NAMES = new Set<string>([
  CURSOR_DEDICATED_GROUP_NAME,
  ...LEGACY_CURSOR_DEDICATED_GROUP_NAMES
])

const CURSOR_RULE_HOST_MARKERS = [
  'cursor.sh',
  'cursor.com',
  'cursorapi.com',
  'cursor-cdn.com',
  'gcpp.cursor'
] as const

function isCursorDedicatedTrafficRuleParts(parts: readonly string[]): boolean {
  const ruleType = parts[0]
  const payload = parts[1]?.toLowerCase() ?? ''

  if (ruleType === 'DOMAIN') {
    return CURSOR_RULE_HOST_MARKERS.some(
      (marker) => payload === marker || payload.endsWith(`.${marker}`) || payload.includes(marker)
    )
  }

  if (ruleType === 'DOMAIN-SUFFIX') {
    return CURSOR_RULE_HOST_MARKERS.some(
      (marker) => payload === marker || payload.endsWith(marker) || marker.endsWith(payload)
    )
  }

  if (ruleType === 'DOMAIN-KEYWORD') {
    return payload.includes('cursor')
  }

  return false
}

function isUnscopedCursorDedicatedRuleParts(parts: readonly string[]): boolean {
  if (parts[0] === 'PROCESS-NAME') {
    return true
  }

  return isCursorDedicatedTrafficRuleParts(parts)
}

function isPathScopedCursorDedicatedRule(rule: string): boolean {
  const trimmed = rule.trim()
  if (trimmed.startsWith('AND,')) {
    return trimmed.includes('PROCESS-PATH')
  }
  return trimmed.startsWith('PROCESS-PATH')
}

/** Drop override/subscription naked Cursor rules so only path-scoped AND rules hit the dedicated group. */
export function stripUnscopedCursorDedicatedRules(profile: MihomoConfig): void {
  const rules = profile.rules as string[] | undefined
  if (!rules?.length) {
    return
  }

  profile.rules = rules.filter((rule) => {
    const parsed = parseRule(rule)
    if (!parsed || !CURSOR_DEDICATED_GROUP_NAMES.has(parsed.policy)) {
      return true
    }

    return isPathScopedCursorDedicatedRule(rule) || !isUnscopedCursorDedicatedRuleParts(parsed.head)
  }) as MihomoConfig['rules']
}

function injectPathScopedDirectFallbackRules(
  prefix: string[],
  existing: Set<string>,
  appPathPrefixes: readonly string[]
): void {
  injectPathScopedRules(prefix, existing, 'DIRECT', appPathPrefixes)
}

function resolveDirectFallbackPathPrefixes(
  dedicatedPathPrefixes: readonly string[],
  nodeSelectPathPrefixes: readonly string[],
  explicitFallbackPathPrefixes: readonly string[] | undefined
): string[] {
  const reserved = new Set(
    [...dedicatedPathPrefixes, ...nodeSelectPathPrefixes]
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  )
  const source =
    explicitFallbackPathPrefixes !== undefined
      ? explicitFallbackPathPrefixes
      : DEFAULT_CURSOR_DIRECT_FALLBACK_APP_PATH_PREFIXES
  return source.map((item) => item.trim()).filter((item) => item.length > 0 && !reserved.has(item))
}

function resolveNodeSelectPathPrefixes(
  dedicatedPathPrefixes: readonly string[],
  explicitNodeSelectPathPrefixes: readonly string[] | undefined
): string[] {
  const dedicated = new Set(
    dedicatedPathPrefixes.map((item) => item.trim()).filter((item) => item.length > 0)
  )
  const source =
    explicitNodeSelectPathPrefixes !== undefined
      ? explicitNodeSelectPathPrefixes
      : DEFAULT_CURSOR_NODE_SELECT_APP_PATH_PREFIXES
  return source.map((item) => item.trim()).filter((item) => item.length > 0 && !dedicated.has(item))
}

function injectPathScopedRules(
  prefix: string[],
  existing: Set<string>,
  mainGroup: string,
  appPathPrefixes: readonly string[]
): void {
  for (const appPrefix of appPathPrefixes) {
    const trimmedPrefix = appPrefix.trim()
    if (!trimmedPrefix) {
      continue
    }

    for (const domain of CURSOR_PROXY_DOMAINS) {
      pushRuleIfMissing(
        prefix,
        existing,
        buildAndRule([`DOMAIN,${domain}`, buildAppBundlePathMatcher(trimmedPrefix)], mainGroup)
      )
    }

    pushRuleIfMissing(
      prefix,
      existing,
      buildAndRule([`DOMAIN-SUFFIX,cursor.sh`, buildAppBundlePathMatcher(trimmedPrefix)], mainGroup)
    )
    pushRuleIfMissing(
      prefix,
      existing,
      buildAndRule(
        [`DOMAIN-SUFFIX,cursor.com`, buildAppBundlePathMatcher(trimmedPrefix)],
        mainGroup
      )
    )

    pushRuleIfMissing(prefix, existing, `${buildAppBundlePathMatcher(trimmedPrefix)},${mainGroup}`)
  }
}

/**
 * Prepend path-scoped Cursor domain rules:
 * - dedicated bundles (default: Cursor 主 / Latest / Cursor-2 / Cursor-3) → 🎯 Cursor 专用
 * - node-select bundles (default: none) → 🚀 节点选择 / 自动选择
 * - optional DIRECT fallback prefixes when configured
 */
export function injectCursorDomainRules(
  profile: MihomoConfig,
  appPathPrefixes: readonly string[] = DEFAULT_CURSOR_PROXY_APP_PATH_PREFIXES,
  directFallbackPathPrefixes: readonly string[] = DEFAULT_CURSOR_DIRECT_FALLBACK_APP_PATH_PREFIXES,
  nodeSelectPathPrefixes: readonly string[] = DEFAULT_CURSOR_NODE_SELECT_APP_PATH_PREFIXES
): void {
  const groups = profile['proxy-groups'] as ControllerMixedGroup[] | undefined
  const dedicatedGroup = resolveCursorStableSelectorGroup(groups ?? [])?.name
  const nodeSelectGroup = resolveGeneralProxySelectGroup(groups ?? [])?.name

  const rules = (profile.rules as string[] | undefined) ?? []
  const existing = new Set(rules.map((rule) => rule.trim()))
  const prefix: string[] = []

  const normalizedDedicated = appPathPrefixes
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  const effectiveDedicated =
    normalizedDedicated.length > 0
      ? normalizedDedicated
      : [...DEFAULT_CURSOR_PROXY_APP_PATH_PREFIXES]

  const nodeSelectPaths = resolveNodeSelectPathPrefixes(effectiveDedicated, nodeSelectPathPrefixes)
  const fallbackPaths = resolveDirectFallbackPathPrefixes(
    effectiveDedicated,
    nodeSelectPaths,
    directFallbackPathPrefixes
  )
  const hasDedicatedWork = Boolean(dedicatedGroup && effectiveDedicated.length > 0)
  const hasNodeSelectWork = Boolean(nodeSelectGroup && nodeSelectPaths.length > 0)
  const hasDirectFallbackWork = fallbackPaths.length > 0
  if (!hasDedicatedWork && !hasNodeSelectWork && !hasDirectFallbackWork) {
    return
  }

  stripUnscopedCursorDedicatedRules(profile)
  if (hasDedicatedWork && dedicatedGroup) {
    injectPathScopedRules(prefix, existing, dedicatedGroup, effectiveDedicated)
  }
  if (hasNodeSelectWork && nodeSelectGroup) {
    injectPathScopedRules(prefix, existing, nodeSelectGroup, nodeSelectPaths)
  }
  if (hasDirectFallbackWork) {
    injectPathScopedDirectFallbackRules(prefix, existing, fallbackPaths)
  }

  if (prefix.length > 0) {
    const remainingRules = (profile.rules as string[] | undefined) ?? []
    profile.rules = [...prefix, ...remainingRules] as MihomoConfig['rules']
  }
}
