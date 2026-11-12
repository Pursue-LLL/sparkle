// [INPUT] 规则文本：`类型,载荷,策略[,修饰符…]`
// [OUTPUT] RULE_BUILTIN_TARGETS · ParsedRule · RulePolicyPicker · parseRule · rewriteRulePolicies
// [POS] 规则文本解析与策略改写的单一出处：策略是修饰符（no-resolve）之前的最后一个字段。
// 各处不再自写 split(',')，改写策略时修饰符与其余字段一律原样保留。

/** 内置出口：不是代理组，规则指向它们不需要对应的组。 */
export const RULE_BUILTIN_TARGETS: ReadonlySet<string> = new Set([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'DNS',
  'NOOP'
])

/** 写在策略之后的规则修饰符。 */
const RULE_MODIFIERS: ReadonlySet<string> = new Set(['no-resolve'])

export interface ParsedRule {
  /** 策略之前的字段（类型、载荷…），已去首尾空白 */
  head: string[]
  /** 已去首尾空白；规则末尾多一个逗号时为空串 */
  policy: string
}

/** 为一条规则挑选新策略；返回 undefined 表示这条规则不动。 */
export type RulePolicyPicker = (rule: ParsedRule) => string | undefined

interface RuleLayout extends ParsedRule {
  /** 逗号拆开的原始字段（保留各字段自身的空白） */
  fields: string[]
  policyIndex: number
}

/** 空行、注释、不足 `类型,载荷,策略` 三段的规则（如 `MATCH,策略`）不参与解析。 */
function layoutOf(rule: string): RuleLayout | undefined {
  const trimmed = rule.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined
  }

  const fields = trimmed.split(',')
  let policyIndex = fields.length - 1
  while (policyIndex >= 0 && RULE_MODIFIERS.has(fields[policyIndex].trim())) {
    policyIndex -= 1
  }
  if (policyIndex < 2) {
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
