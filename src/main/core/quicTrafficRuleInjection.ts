// [INPUT] 无本地依赖
// [OUTPUT] QUIC_REJECT_RULE · STUN_CLOUDFLARE_REJECT_RULE · QUIC_PROTECTION_RULES · injectQuicTrafficRules
// [POS] QUIC（UDP 443）与 Cloudflare STUN 阻断规则：在规则链里恰好各一条且排在最前，避免 TCP 走代理而 UDP 回落直连造成双栈出口 IP 不一致；链中任何位置的同文副本（覆写或订阅带来的）都并入这一条。

/**
 * QUIC (HTTP/3) and WebRTC STUN leak protection rules.
 *
 * Prevents dual-stack IP divergence (TCP over proxy, UDP falling back to DIRECT)
 * which triggers Cloudflare Turnstile / WAF "Sorry, you have been blocked" errors.
 */
export const QUIC_REJECT_RULE = 'AND,((DST-PORT,443),(NETWORK,UDP)),REJECT' as const
export const STUN_CLOUDFLARE_REJECT_RULE = 'DOMAIN-SUFFIX,stun.cloudflare.com,REJECT' as const

export const QUIC_PROTECTION_RULES = [QUIC_REJECT_RULE, STUN_CLOUDFLARE_REJECT_RULE] as const

/**
 * Put QUIC and STUN rejection rules at the top of the rules array, exactly once each.
 * Ensures browsers immediately drop UDP 443 with ICMP port unreachable
 * and fall back cleanly to HTTP/2 (TLS over TCP proxy).
 *
 * Same-text copies elsewhere in the chain are removed rather than left in place:
 * a copy buried behind the dedicated-group and direct-bypass rules lets the UDP 443
 * traffic those rules match skip the rejection.
 */
export function injectQuicTrafficRules(profile: MihomoConfig): void {
  const protection = new Set<string>(QUIC_PROTECTION_RULES)
  const rest = ((profile.rules as string[] | undefined) ?? []).filter(
    (rule) => !protection.has(rule.trim())
  )

  profile.rules = [...QUIC_PROTECTION_RULES, ...rest] as MihomoConfig['rules']
}
