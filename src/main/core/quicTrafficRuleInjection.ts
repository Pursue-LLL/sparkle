/**
 * QUIC (HTTP/3) and WebRTC STUN leak protection rules.
 *
 * Prevents dual-stack IP divergence (TCP over proxy, UDP falling back to DIRECT)
 * which triggers Cloudflare Turnstile / WAF "Sorry, you have been blocked" errors.
 */
export const QUIC_REJECT_RULE = 'AND,((DST-PORT,443),(NETWORK,UDP)),REJECT' as const
export const STUN_CLOUDFLARE_REJECT_RULE = 'DOMAIN-SUFFIX,stun.cloudflare.com,REJECT' as const

export const QUIC_PROTECTION_RULES = [
  QUIC_REJECT_RULE,
  STUN_CLOUDFLARE_REJECT_RULE
] as const

/**
 * Prepend QUIC and STUN rejection rules to the top of rules array.
 * Ensures browsers immediately drop UDP 443 with ICMP port unreachable
 * and fall back cleanly to HTTP/2 (TLS over TCP proxy).
 */
export function injectQuicTrafficRules(profile: MihomoConfig): void {
  const existing = (profile.rules as string[] | undefined) ?? []
  const existingSet = new Set(existing.map((rule) => rule.trim()))
  const prefix: string[] = []

  for (const rule of QUIC_PROTECTION_RULES) {
    if (!existingSet.has(rule)) {
      prefix.push(rule)
      existingSet.add(rule)
    }
  }

  if (prefix.length === 0) {
    return
  }

  profile.rules = [...prefix, ...existing] as MihomoConfig['rules']
}
