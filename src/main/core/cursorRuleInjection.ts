import {
  CURSOR_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  resolveCursorStableSelectorGroup
} from './cursorProxyGroup'

/** Optional macOS bundle path prefixes for path-scoped AND rules (advanced; default routes all Cursor traffic). */
export const DEFAULT_CURSOR_PROXY_APP_PATH_PREFIXES = [] as const

/** macOS / Electron Cursor outbound processes — legacy fallback when no app path prefixes. */
export const CURSOR_PROCESS_NAMES = [
  'Cursor',
  'Cursor Helper',
  'Cursor Helper (Renderer)',
  'Cursor Helper (Plugin)',
  'Cursor Helper (GPU)'
] as const

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

function injectLegacyProcessRules(prefix: string[], existing: Set<string>, mainGroup: string): void {
  for (const domain of CURSOR_PROXY_DOMAINS) {
    pushRuleIfMissing(prefix, existing, `DOMAIN,${domain},${mainGroup}`)
  }
  pushRuleIfMissing(prefix, existing, `DOMAIN-SUFFIX,cursor.sh,${mainGroup}`)
  pushRuleIfMissing(prefix, existing, `DOMAIN-SUFFIX,cursor.com,${mainGroup}`)

  for (const processName of CURSOR_PROCESS_NAMES) {
    pushRuleIfMissing(prefix, existing, `PROCESS-NAME,${processName},${mainGroup}`)
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
    const trimmed = rule.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return true
    }
    if (isPathScopedCursorDedicatedRule(trimmed)) {
      return true
    }

    const parts = trimmed.split(',').map((part) => part.trim())
    if (parts.length < 3) {
      return true
    }

    const policy = parts[parts.length - 1]
    if (!CURSOR_DEDICATED_GROUP_NAMES.has(policy)) {
      return true
    }

    return !isCursorDedicatedTrafficRuleParts(parts)
  }) as MihomoConfig['rules']
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
      buildAndRule([`DOMAIN-SUFFIX,cursor.com`, buildAppBundlePathMatcher(trimmedPrefix)], mainGroup)
    )

    pushRuleIfMissing(prefix, existing, `${buildAppBundlePathMatcher(trimmedPrefix)},${mainGroup}`)
  }
}

/**
 * Prepend Cursor domain + process rules so Agent/Chat traffic uses a fixed Selector (never UrlTest).
 * Default (empty appPathPrefixes): all Cursor PROCESS-NAME + DOMAIN traffic → dedicated group.
 * Non-empty appPathPrefixes: path-scoped AND rules for specific .app bundles only.
 */
export function injectCursorDomainRules(
  profile: MihomoConfig,
  appPathPrefixes: readonly string[] = DEFAULT_CURSOR_PROXY_APP_PATH_PREFIXES
): void {
  const groups = profile['proxy-groups'] as ControllerMixedGroup[] | undefined
  const mainGroup = resolveCursorStableSelectorGroup(groups ?? [])?.name
  if (!mainGroup) return

  const rules = (profile.rules as string[] | undefined) ?? []
  const existing = new Set(rules.map((rule) => rule.trim()))
  const prefix: string[] = []

  const normalizedPrefixes = appPathPrefixes.map((item) => item.trim()).filter((item) => item.length > 0)
  if (normalizedPrefixes.length > 0) {
    stripUnscopedCursorDedicatedRules(profile)
    injectPathScopedRules(prefix, existing, mainGroup, normalizedPrefixes)
  } else {
    injectLegacyProcessRules(prefix, existing, mainGroup)
  }

  if (prefix.length > 0) {
    const remainingRules = (profile.rules as string[] | undefined) ?? []
    profile.rules = [...prefix, ...remainingRules] as MihomoConfig['rules']
  }
}
