import { GROK_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { HONG_KONG_FILTER_GROUP_NAME } from './customProxyGroups'

/** X / Twitter / Stripe — routed to the HK url-test group. */
const HONG_KONG_TRAFFIC_RULE_BASES = [
  'DOMAIN-SUFFIX,x.com',
  'DOMAIN-KEYWORD,twitter',
  'DOMAIN-SUFFIX,twitter.com',
  'DOMAIN-SUFFIX,t.co',
  'DOMAIN-SUFFIX,twimg.co',
  'DOMAIN-SUFFIX,twimg.com',
  'DOMAIN-SUFFIX,twimg.org',
  'DOMAIN-SUFFIX,stripe.com'
] as const

/** Grok web app — routed to the group that only accepts nodes returning HTTP 200. */
const GROK_TRAFFIC_RULE_BASES = ['DOMAIN-SUFFIX,grok.com'] as const

function hasProxyGroup(profile: MihomoConfig, name: string): boolean {
  const groups = profile['proxy-groups'] as { name: string }[] | undefined
  return groups?.some((group) => group.name === name) ?? false
}

/** Prepend rules so they beat subscription 🚀 节点选择 / 🤖 OpenAI targets. Idempotent. */
function prependTrafficRules(
  profile: MihomoConfig,
  ruleBases: readonly string[],
  groupName: string
): void {
  if (!hasProxyGroup(profile, groupName)) {
    return
  }

  const existing = (profile.rules as string[] | undefined) ?? []
  const existingSet = new Set(existing.map((rule) => rule.trim()))
  const prefix: string[] = []

  for (const ruleBase of ruleBases) {
    const rule = `${ruleBase},${groupName}`
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

export function injectDedicatedTrafficRules(profile: MihomoConfig): void {
  prependTrafficRules(profile, HONG_KONG_TRAFFIC_RULE_BASES, HONG_KONG_FILTER_GROUP_NAME)
  prependTrafficRules(profile, GROK_TRAFFIC_RULE_BASES, GROK_DEDICATED_GROUP_NAME)
}
