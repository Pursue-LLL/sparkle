// [INPUT] MihomoConfig.rules
// [OUTPUT] ensureCnDirectBaseline: 配置缺少国内分流能力时补国内直连基线
// [POS] runtime 配置生成流水线的国内直连兜底层。订阅降级（下发 0 规则）时配置只剩应用注入的专用规则与
// MATCH→代理，国内流量会整体被送进代理节点；基线保证「国内直连、其余走代理」这一最低语义恒成立。

const CN_DIRECT_BASELINE_RULES = ['GEOSITE,CN,DIRECT', 'GEOIP,CN,DIRECT'] as const

/** 已具备国内分流能力：存在 GEOIP/GEOSITE 的 CN 规则，或使用 RULE-SET（规则集内容由订阅方负责）。 */
const CN_AWARE_RULE_PATTERN = /^(?:(?:GEOIP|GEOSITE)\s*,\s*cn\s*,|RULE-SET\s*,)/i
const MATCH_RULE_PATTERN = /^MATCH\s*,/i

/** 在最后一条 MATCH 之前（无 MATCH 则末尾）补基线；订阅自带国内规则时不改动。返回是否注入。 */
export function ensureCnDirectBaseline(profile: MihomoConfig): boolean {
  const rules = (profile.rules as string[] | undefined) ?? []
  if (rules.some((rule) => CN_AWARE_RULE_PATTERN.test(rule.trim()))) {
    return false
  }

  const matchIndex = rules.findLastIndex((rule) => MATCH_RULE_PATTERN.test(rule.trim()))
  const insertAt = matchIndex === -1 ? rules.length : matchIndex
  profile.rules = [
    ...rules.slice(0, insertAt),
    ...CN_DIRECT_BASELINE_RULES,
    ...rules.slice(insertAt)
  ] as MihomoConfig['rules']
  return true
}
