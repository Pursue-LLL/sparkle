import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { AUTO_SELECT_GROUP_NAME } from './defaultAutoSwitchProxy'

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

function migrateRuleTarget(rule: string, target: string): string {
  const parts = rule.split(',').map((part) => part.trim())
  if (parts.length !== 3) {
    return rule
  }
  const [type, payload, policy] = parts
  const bases: readonly string[] = ANTIGRAVITY_TRAFFIC_RULE_BASES
  if (!bases.includes(`${type},${payload}`)) {
    return rule
  }
  if (!ANTIGRAVITY_RULE_TARGETS.has(policy) || policy === target) {
    return rule
  }
  return `${type},${payload},${target}`
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

  const existing = (profile.rules as string[] | undefined) ?? []
  const migrated = existing.map((rule) => migrateRuleTarget(rule, target))
  const migratedSet = new Set(migrated.map((rule) => rule.trim()))
  const prefix: string[] = []

  for (const ruleBase of ANTIGRAVITY_TRAFFIC_RULE_BASES) {
    const rule = `${ruleBase},${target}`
    if (!migratedSet.has(rule)) {
      prefix.push(rule)
    }
  }

  profile.rules = (prefix.length > 0 ? [...prefix, ...migrated] : migrated) as MihomoConfig['rules']
}
