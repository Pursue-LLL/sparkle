/**
 * [INPUT] MihomoConfig profile（generateProfile 的规则注入阶段，覆写已先生效）
 * [OUTPUT] AI_API_DIRECT_HOSTS · ensureAiApiDirectRules: 为未被任何规则提及的目标域名补 DIRECT 默认
 * [POS] 默认直连规则的唯一出口。只补缺省、遇规则即让路，保证 覆写 > 订阅 > 内置默认。
 */

/**
 * 两个端点只承载 AI API 流量，劫持它们不影响普通网站。
 * 同机同端点各 6 次采样（curl 端到端首字节 p50）：api.commandcode.ai 993ms → 672ms；
 * opencode.ai 1582ms → 930ms（代理为新加坡节点，直连出口为本地联通）。
 * 新增域名只改这里：单测按此清单生成期望值。
 */
export const AI_API_DIRECT_HOSTS = ['api.commandcode.ai', 'opencode.ai'] as const

/** 只识别常见的三种域名类规则；RULE-SET / GEOSITE 等动态规则源不参与判断。 */
const DOMAIN_RULE_TYPES: ReadonlySet<string> = new Set([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD'
])

/**
 * 这条规则是否与目标域名相关：同一域名、它的父域、或它下面更具体的子域都算。
 * 子域也算——默认规则是宽后缀，一旦注入就会抢先命中子域，等于压掉用户那条更具体的规则。
 */
function ruleTouchesHost(rule: string, host: string): boolean {
  const [type, payload] = rule.split(',').map((part) => part.trim())
  if (!DOMAIN_RULE_TYPES.has(type) || !payload) {
    return false
  }
  const target = payload.toLowerCase().replace(/^\./, '')
  if (type === 'DOMAIN-KEYWORD') {
    return host.includes(target) || target.includes(host)
  }
  return target === host || host.endsWith(`.${target}`) || target.endsWith(`.${host}`)
}

/**
 * 域名已被覆写或订阅提及（不论指向哪个策略、也不论是父域还是子域）就完全保持原样：
 * 既不改写目标，也不追加第二条规则——用户想恢复走代理只需自己写一条规则。
 */
export function ensureAiApiDirectRules(profile: MihomoConfig): void {
  const existing = (profile.rules as string[] | undefined) ?? []
  const uncovered = AI_API_DIRECT_HOSTS.filter(
    (host) => !existing.some((rule) => ruleTouchesHost(rule, host))
  )
  if (uncovered.length === 0) {
    return
  }
  const prefix = uncovered.map((host) => `DOMAIN-SUFFIX,${host},DIRECT`)
  profile.rules = [...prefix, ...existing] as MihomoConfig['rules']
}
