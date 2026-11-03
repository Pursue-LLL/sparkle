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
const AI_API_DIRECT_HOSTS = ['api.commandcode.ai', 'opencode.ai'] as const

/** 只识别常见的三种域名类规则；RULE-SET / GEOSITE 等动态规则源不参与判断。 */
const DOMAIN_RULE_TYPES: ReadonlySet<string> = new Set([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD'
])

/** 这条规则会不会命中该 host——命中即代表有人已经对这些域名表过态。 */
function ruleCoversHost(rule: string, host: string): boolean {
  const [type, payload] = rule.split(',').map((part) => part.trim())
  if (!DOMAIN_RULE_TYPES.has(type) || !payload) {
    return false
  }
  const target = payload.toLowerCase()
  if (type === 'DOMAIN') {
    return target === host
  }
  if (type === 'DOMAIN-SUFFIX') {
    return host === target || host.endsWith(`.${target}`)
  }
  return host.includes(target)
}

/**
 * 域名已被覆写或订阅写过（不论指向哪个策略）就完全保持原样：既不改写目标，也不追加第二条规则。
 * 这样优先级天然是 覆写 > 订阅 > 内置默认，用户想恢复走代理只需自己写一条规则。
 */
export function ensureAiApiDirectRules(profile: MihomoConfig): void {
  const existing = (profile.rules as string[] | undefined) ?? []
  const uncovered = AI_API_DIRECT_HOSTS.filter(
    (host) => !existing.some((rule) => ruleCoversHost(rule, host))
  )
  if (uncovered.length === 0) {
    return
  }
  const prefix = uncovered.map((host) => `DOMAIN-SUFFIX,${host},DIRECT`)
  profile.rules = [...prefix, ...existing] as MihomoConfig['rules']
}
