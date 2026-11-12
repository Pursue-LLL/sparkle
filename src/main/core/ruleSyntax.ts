// [INPUT] 规则文本，字段布局与 mihomo 的解析一致（v1.19.32 经 `mihomo -t` 与回环代理实测）：
//   `类型,载荷,策略[,参数…]`；兜底规则 `MATCH,策略[,参数…]`；载荷自带逗号的类型
//   （AND / OR / NOT、DOMAIN-REGEX、PROCESS-NAME-REGEX、PROCESS-PATH-REGEX）取最后一个字段为策略，其后不接参数；
//   `SUB-RULE,(条件),子规则名` 指向 `sub-rules` 里的子规则，不是策略。
// [OUTPUT] RULE_BUILTIN_TARGETS · ParsedRule · RulePolicyPicker · parseRule · rewriteRulePolicies
// [POS] 规则文本解析与策略改写的单一出处：改写策略时其余字段（含 no-resolve、src 等参数）一律原样保留。
// 参数不在这里枚举：内核认哪些、忽略哪些，由它自己决定；这里只负责找到策略所在的字段。

/** 内置出口：不是代理组，规则指向它们不需要对应的组。 */
export const RULE_BUILTIN_TARGETS: ReadonlySet<string> = new Set([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'DNS',
  'NOOP'
])

/** 兜底规则 `MATCH,策略` 没有载荷。 */
const PAYLOADLESS_RULE_TYPE = 'MATCH'

/** 载荷自带逗号的规则类型：内核取最后一个字段为策略，其后不接参数。 */
const COMMA_PAYLOAD_RULE_TYPES: ReadonlySet<string> = new Set([
  'AND',
  'OR',
  'NOT',
  'DOMAIN-REGEX',
  'PROCESS-NAME-REGEX',
  'PROCESS-PATH-REGEX'
])

/** 目标是 `sub-rules` 里的子规则名，不是代理组或节点，不参与策略解析与改写。 */
const SUB_RULE_TYPE = 'SUB-RULE'

export interface ParsedRule {
  /** 策略之前的字段（类型、载荷…），已去首尾空白 */
  head: string[]
  /** 已去首尾空白；策略字段为空（如 `DOMAIN,a.com,`）时为空串 */
  policy: string
}

/** 为一条规则挑选新策略；返回 undefined 表示这条规则不动。 */
export type RulePolicyPicker = (rule: ParsedRule) => string | undefined

interface RuleLayout extends ParsedRule {
  /** 逗号拆开的原始字段（保留各字段自身的空白） */
  fields: string[]
  policyIndex: number
}

/** 策略字段在逗号拆开后的下标；类型 / 载荷 / 策略不全，或目标不是策略时为 undefined。 */
function policyIndexOf(ruleType: string, fieldCount: number): number | undefined {
  if (ruleType === SUB_RULE_TYPE) {
    return undefined
  }
  if (ruleType === PAYLOADLESS_RULE_TYPE) {
    return fieldCount > 1 ? 1 : undefined
  }
  const index = COMMA_PAYLOAD_RULE_TYPES.has(ruleType) ? fieldCount - 1 : 2
  return index >= 2 && index < fieldCount ? index : undefined
}

/** 空行、注释、没有策略字段的规则与 `SUB-RULE` 不参与解析。 */
function layoutOf(rule: string): RuleLayout | undefined {
  const trimmed = rule.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined
  }

  const fields = trimmed.split(',')
  const policyIndex = policyIndexOf(fields[0].trim().toUpperCase(), fields.length)
  if (policyIndex === undefined) {
    return undefined
  }

  return {
    fields,
    policyIndex,
    head: fields.slice(0, policyIndex).map((field) => field.trim()),
    policy: fields[policyIndex].trim()
  }
}

export function parseRule(rule: string): ParsedRule | undefined {
  const layout = layoutOf(rule)
  return layout && { head: layout.head, policy: layout.policy }
}

/** 逐条改写 profile.rules 的策略；策略为空的规则不交给 pick。 */
export function rewriteRulePolicies(profile: MihomoConfig, pick: RulePolicyPicker): void {
  const rules = profile.rules as string[] | undefined
  if (!rules?.length) {
    return
  }

  profile.rules = rules.map((rule) => {
    const layout = layoutOf(rule)
    const next = layout?.policy ? pick({ head: layout.head, policy: layout.policy }) : undefined
    if (!layout || !next) {
      return rule
    }
    const fields = [...layout.fields]
    fields[layout.policyIndex] = next
    return fields.join(',')
  }) as MihomoConfig['rules']
}
