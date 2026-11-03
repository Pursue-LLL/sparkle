/**
 * [INPUT] 生成中的 mihomo profile
 * [OUTPUT] 前置直连规则：AI API 端点不经过任何代理组
 * [POS] AI CLI（opencode / commandcode）的 API 端点本机实测可直连且更快，故此处置为硬编码 DIRECT。
 */

/**
 * 两个端点都只承载 AI API 流量，劫持它们不影响任何普通网站。
 * 同机同端点各 6 次采样（TTFB p50）：api.commandcode.ai 代理 993ms → 直连 558ms；
 * opencode.ai 代理 1582ms → 直连 627ms（代理为新加坡节点，直连出口为本地联通）。
 */
const AI_API_DIRECT_RULE_BASES = [
  'DOMAIN-SUFFIX,api.commandcode.ai',
  'DOMAIN-SUFFIX,opencode.ai'
] as const

const DIRECT = 'DIRECT' as const

function ruleBase(rule: string): string {
  const parts = rule.split(',').map((part) => part.trim())
  return parts.length >= 3 ? `${parts[0]},${parts[1]}` : ''
}

/**
 * 订阅或历史配置可能已经写过同一域名（指向代理组）：改写目标而不是留下两条互相矛盾的规则。
 */
function retargetToDirect(rules: readonly string[]): string[] {
  const bases = new Set<string>(AI_API_DIRECT_RULE_BASES)
  return rules.map((rule) => (bases.has(ruleBase(rule)) ? `${ruleBase(rule)},${DIRECT}` : rule))
}

/** 规则前置，才能压过订阅里的 GEOIP/MATCH 兜底与一切通用后缀规则。 */
export function ensureAiApiDirectRules(profile: MihomoConfig): void {
  const existing = (profile.rules as string[] | undefined) ?? []
  const retargeted = retargetToDirect(existing)
  const present = new Set(retargeted.map((rule) => rule.trim()))
  const prefix = AI_API_DIRECT_RULE_BASES.map((base) => `${base},${DIRECT}`).filter(
    (rule) => !present.has(rule)
  )
  const changed = prefix.length > 0 || retargeted.some((rule, index) => rule !== existing[index])
  if (!changed) {
    return
  }
  profile.rules = [...prefix, ...retargeted] as MihomoConfig['rules']
}
