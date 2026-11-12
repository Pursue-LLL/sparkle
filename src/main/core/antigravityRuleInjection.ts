import { AGY_DEDICATED_GROUP_NAME, AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import { parseRule, rewriteRulePolicies } from './ruleSyntax'

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
  'DOMAIN-SUFFIX,generativelanguage.googleapis.com',
  // agy CLI 启动时的 Eligibility check 走这里；走通用出口在当前订阅下会 SSL EOF，
  // 导致整轮探测全部 unknown（代理页表现为"全都未测"）。
  'DOMAIN,www.googleapis.com'
] as const

/** 规则「类型,载荷」部分，用来认出自己写过的规则。 */
const ANTIGRAVITY_RULE_HEADS: ReadonlySet<string> = new Set(ANTIGRAVITY_TRAFFIC_RULE_BASES)

/** 规则可能被上一版目标组写过，改写而不是重复追加。 */
const ANTIGRAVITY_RULE_TARGETS: ReadonlySet<string> = new Set([
  AGY_DEDICATED_GROUP_NAME,
  AUTO_SELECT_GROUP_NAME
])

/**
 * 目标组优先级：`🎯 agy 专用`（只含真实 agy 请求验证通过的节点）优先；
 * 该组缺席（老配置 / provider 生成失败）时退回 `自动选择`，绝不把规则指空。
 */
function resolveAntigravityTargetGroup(profile: MihomoConfig): string | null {
  const groups = profile['proxy-groups'] as { name: string }[] | undefined
  if (groups?.some((group) => group.name === AGY_DEDICATED_GROUP_NAME)) {
    return AGY_DEDICATED_GROUP_NAME
  }
  if (groups?.some((group) => group.name === AUTO_SELECT_GROUP_NAME)) {
    return AUTO_SELECT_GROUP_NAME
  }
  return null
}

/** 去掉空白与修饰符后的 `类型,载荷,策略`，用来判断规则是否已存在。 */
function canonicalRule(rule: string): string {
  const parsed = parseRule(rule)
  return parsed ? [...parsed.head, parsed.policy].join(',') : rule.trim()
}

/**
 * Prepend Antigravity/Code-Assist rules so they beat the subscription's generic
 * `DOMAIN-SUFFIX,googleapis.com` rule.
 */
export function injectAntigravityTrafficRules(profile: MihomoConfig): void {
  const target = resolveAntigravityTargetGroup(profile)
  if (!target) {
    return
  }

  rewriteRulePolicies(profile, ({ head, policy }) =>
    ANTIGRAVITY_RULE_TARGETS.has(policy) && ANTIGRAVITY_RULE_HEADS.has(head.join(','))
      ? target
      : undefined
  )

  const existing = (profile.rules as string[] | undefined) ?? []
  const present = new Set(existing.map(canonicalRule))
  const missing = ANTIGRAVITY_TRAFFIC_RULE_BASES.map((base) => `${base},${target}`).filter(
    (rule) => !present.has(rule)
  )

  profile.rules = [...missing, ...existing] as MihomoConfig['rules']
}
