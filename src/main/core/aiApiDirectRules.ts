/**
 * [INPUT] 生成中的 mihomo profile
 * [OUTPUT] 默认直连规则：AI API 端点在没有其它规则时走 DIRECT
 * [POS] 只补默认值，绝不覆盖覆写/订阅的意图——覆写在 factory 里先生效，故此处必须"缺才加"。
 */

/**
 * 两个端点只承载 AI API 流量，劫持它们不影响普通网站。
 * 同机同端点各 6 次采样（curl 端到端首字节 p50）：api.commandcode.ai 993ms → 672ms；
 * opencode.ai 1582ms → 930ms（代理为新加坡节点，直连出口为本地联通）。
 */
const AI_API_DIRECT_RULE_BASES = [
  'DOMAIN-SUFFIX,api.commandcode.ai',
  'DOMAIN-SUFFIX,opencode.ai'
] as const

function ruleBase(rule: string): string {
  const parts = rule.split(',').map((part) => part.trim())
  return parts.length >= 3 ? `${parts[0]},${parts[1]}` : ''
}

/**
 * 域名已有任何规则（覆写或订阅写的）时保持原样：用户意图优先于内置默认值，
 * 既不改写目标，也不追加第二条互相矛盾的规则。
 */
export function ensureAiApiDirectRules(profile: MihomoConfig): void {
  const existing = (profile.rules as string[] | undefined) ?? []
  const claimed = new Set(existing.map(ruleBase))
  const prefix = AI_API_DIRECT_RULE_BASES.filter((base) => !claimed.has(base)).map(
    (base) => `${base},DIRECT`
  )
  if (prefix.length === 0) {
    return
  }
  profile.rules = [...prefix, ...existing] as MihomoConfig['rules']
}
