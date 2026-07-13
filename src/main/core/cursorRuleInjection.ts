import {
  resolveCursorStableSelectorGroup
} from './cursorProxyGroup'

/** Default macOS bundle paths that should use Cursor 3.1.15 专用 (exclude other Cursor installs). */
export const DEFAULT_CURSOR_PROXY_APP_PATH_PREFIXES = [
  '/Applications/Cursor-3.1.15.app'
] as const

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
  'api5.cursor.sh',
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
 * When appPathPrefixes is set, only those Cursor installs match (e.g. 3.1.15 yes, 3.10.17 no).
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
    injectPathScopedRules(prefix, existing, mainGroup, normalizedPrefixes)
  } else {
    injectLegacyProcessRules(prefix, existing, mainGroup)
  }

  if (prefix.length > 0) {
    profile.rules = [...prefix, ...rules] as MihomoConfig['rules']
  }
}
