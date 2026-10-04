import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'

/**
 * Google Code Assist / Gemini API hosts whose edge enforces per-region geo
 * restrictions (400 FAILED_PRECONDITION "User location is not supported for
 * the API use."). All are pure AI-API endpoints, so taking them over carries
 * zero collateral for general Google traffic (YouTube / Drive / Search).
 *
 * `DOMAIN-KEYWORD,cloudcode-pa` covers every host observed in core logs:
 * cloudcode-pa / daily-cloudcode-pa / daily-cloudcode-pa.sandbox.googleapis.com.
 */
const ANTIGRAVITY_TRAFFIC_RULE_BASES = [
  'DOMAIN-KEYWORD,cloudcode-pa',
  'DOMAIN-SUFFIX,aicode.googleapis.com',
  'DOMAIN-SUFFIX,generativelanguage.googleapis.com'
] as const

function hasCursorDedicatedGroup(profile: MihomoConfig): boolean {
  const groups = profile['proxy-groups'] as { name: string }[] | undefined
  return groups?.some((group) => group.name === CURSOR_DEDICATED_GROUP_NAME) ?? false
}

/**
 * Prepend Antigravity/Code-Assist rules so they beat the subscription's generic
 * `DOMAIN-SUFFIX,googleapis.com` rule. Target is 🎯 Cursor 专用 (fallback over
 * the KR VPS pool — fixed physical exit). Google judges the exit IP geo per
 * request; airport hop nodes drift their exit IP pool (ports 15001-16000,
 * hop-interval 15s) into geo-rejected segments — measured as intermittent 400s
 * on 台湾 02 windows — so 自动选择 must never be the target here.
 */
export function injectAntigravityTrafficRules(profile: MihomoConfig): void {
  if (!hasCursorDedicatedGroup(profile)) {
    return
  }

  const existing = (profile.rules as string[] | undefined) ?? []
  const existingSet = new Set(existing.map((rule) => rule.trim()))
  const prefix: string[] = []

  for (const ruleBase of ANTIGRAVITY_TRAFFIC_RULE_BASES) {
    const rule = `${ruleBase},${CURSOR_DEDICATED_GROUP_NAME}`
    if (!existingSet.has(rule)) {
      prefix.push(rule)
      existingSet.add(rule)
    }
  }

  if (prefix.length === 0) {
    return
  }

  profile.rules = [...prefix, ...existing] as MihomoConfig['rules']
}
