// [INPUT] cursorProxyGroup::GEMINI_DEDICATED_GROUP_NAME/GROK_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         customProxyGroups::HONG_KONG_FILTER_GROUP_NAME (POS: Sparkle 自有分组注入)
// [OUTPUT] injectDedicatedTrafficRules: X / Twitter / Stripe → Sparkle-香港，grok.com → grok 专用，Gemini 域名 → gemini专用
// [POS] 香港、grok 与 Gemini 专用流量的前置规则：对应分组存在才注入，已有同文规则不重复，排在订阅的节点选择 / OpenAI 规则之前。

import { GEMINI_DEDICATED_GROUP_NAME, GROK_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
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

/**
 * Gemini 网页端与 AI Studio 网页端 — routed to the region-verified Gemini group.
 * `generativelanguage.googleapis.com`（Gemini API）不在此列：它已由 antigravityRuleInjection
 * 指向经真实 Google AI 请求验证的 `🎯 agy 专用`，两处同时抢同一域名只会留下一条被遮蔽的死规则。
 */
const GEMINI_TRAFFIC_RULE_BASES = [
  'DOMAIN-SUFFIX,gemini.google.com',
  'DOMAIN-SUFFIX,aistudio.google.com'
] as const

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
  prependTrafficRules(profile, GEMINI_TRAFFIC_RULE_BASES, GEMINI_DEDICATED_GROUP_NAME)
}
