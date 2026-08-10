import { HONG_KONG_FILTER_GROUP_NAME } from './customProxyGroups'

/** Stripe / X / Grok — routed to HK url-test group (Grok reachability probe). */
const HONG_KONG_TRAFFIC_RULE_BASES = [
  'DOMAIN-SUFFIX,x.com',
  'DOMAIN-KEYWORD,twitter',
  'DOMAIN-SUFFIX,twitter.com',
  'DOMAIN-SUFFIX,t.co',
  'DOMAIN-SUFFIX,twimg.co',
  'DOMAIN-SUFFIX,twimg.com',
  'DOMAIN-SUFFIX,twimg.org',
  'DOMAIN-SUFFIX,grok.com',
  'DOMAIN-SUFFIX,stripe.com'
] as const

function hasHongKongFilterGroup(profile: MihomoConfig): boolean {
  const groups = profile['proxy-groups'] as { name: string }[] | undefined
  return groups?.some((group) => group.name === HONG_KONG_FILTER_GROUP_NAME) ?? false
}

/** Prepend X/Twitter/Grok/Stripe rules so they beat subscription 🚀 节点选择 / 🤖 OpenAI targets. */
export function injectHongKongTrafficRules(profile: MihomoConfig): void {
  if (!hasHongKongFilterGroup(profile)) {
    return
  }

  const existing = (profile.rules as string[] | undefined) ?? []
  const existingSet = new Set(existing.map((rule) => rule.trim()))
  const prefix: string[] = []

  for (const ruleBase of HONG_KONG_TRAFFIC_RULE_BASES) {
    const rule = `${ruleBase},${HONG_KONG_FILTER_GROUP_NAME}`
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
