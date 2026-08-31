// [INPUT] MihomoConfig.rules
// [OUTPUT] ensureCodexDirectRules — Codex/OpenAI/ChatGPT → DIRECT
// [POS] W2 hardening — Codex must not share Marathon Cursor HY2 / 🤖 AI carrier.

/** Domains Codex uses (aligned with openaiDnsIntegrity PROXY_DOMAIN_NAMESERVER_POLICY). */
export const CODEX_DIRECT_DOMAIN_RULES = [
  'DOMAIN-SUFFIX,chatgpt.com,DIRECT',
  'DOMAIN-SUFFIX,openai.com,DIRECT',
  'DOMAIN-SUFFIX,oaistatic.com,DIRECT',
  'DOMAIN-SUFFIX,oaiusercontent.com,DIRECT',
  'DOMAIN-KEYWORD,chatgpt,DIRECT',
  'DOMAIN-KEYWORD,openai,DIRECT',
] as const

/** macOS process names observed in mihomo core logs for Codex. */
export const CODEX_DIRECT_PROCESS_RULES = [
  'PROCESS-NAME,Codex,DIRECT',
  'PROCESS-NAME,Codex (Service),DIRECT',
] as const

const CODEX_DIRECT_RULES = [
  ...CODEX_DIRECT_PROCESS_RULES,
  ...CODEX_DIRECT_DOMAIN_RULES,
] as const

function ruleIdentity(rule: string): string {
  const parts = rule.trim().split(',')
  if (parts.length < 2) {
    return rule.trim()
  }
  // Match by type+payload so DOMAIN-SUFFIX,chatgpt.com,🤖 AI is replaced by DIRECT.
  return `${parts[0]},${parts[1]}`.toLowerCase()
}

function isCodexDirectIdentity(identity: string): boolean {
  return CODEX_DIRECT_RULES.some((rule) => ruleIdentity(rule) === identity)
}

/**
 * Prepend Codex/OpenAI DIRECT rules and strip conflicting subscription targets
 * (e.g. DOMAIN-SUFFIX,chatgpt.com,🤖 AI) so Codex never rides Marathon HY2.
 */
export function ensureCodexDirectRules(profile: MihomoConfig): {
  added: number
  stripped: number
} {
  const existing = (profile.rules as string[] | undefined) ?? []
  const strippedConflicts = existing.filter((rule) => {
    const identity = ruleIdentity(rule)
    if (!isCodexDirectIdentity(identity)) {
      return true
    }
    // Keep only if already DIRECT; drop AI/GFW/node-select targets for same host.
    const parts = rule.trim().split(',')
    const policy = parts[parts.length - 1]?.trim()
    return policy === 'DIRECT'
  })
  const stripped = existing.length - strippedConflicts.length
  const existingSet = new Set(strippedConflicts.map((rule) => rule.trim()))
  const additions = CODEX_DIRECT_RULES.filter((rule) => !existingSet.has(rule))
  if (additions.length === 0 && stripped === 0) {
    return { added: 0, stripped: 0 }
  }
  profile.rules = [...additions, ...strippedConflicts] as MihomoConfig['rules']
  return { added: additions.length, stripped }
}

export function formatCodexDirectRulesLogLine(result: {
  added: number
  stripped: number
}): string {
  return (
    `[CodexDirect]: outcome=${result.added > 0 || result.stripped > 0 ? 'executed' : 'noop'}` +
    ` added=${result.added}` +
    ` stripped=${result.stripped}\n`
  )
}
