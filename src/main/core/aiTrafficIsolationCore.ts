// [INPUT] Mihomo proxy-groups · marathon HY2 leaf SSOT
// [OUTPUT] excludeMarathonHy2FromAiProxyGroups · isAiTrafficProxyGroupName
// [POS] W2 — Codex/AI must not share Marathon Cursor JP-VPS-HY2 carrier (prevents co-death).

import { MARATHON_CURSOR_OPTIMAL_VPS_NODE } from './marathonHy2OnlyCore'

/** AI / Codex outbound groups — keep separate from Marathon Cursor HY2. */
const AI_TRAFFIC_GROUP_NAME_RE =
  /🤖\s*(AI|OpenAI)|OpenAI|ChatGPT|Claude|Codex|\bai\b.*(?:选|组|节点)|(?:选|组|节点).*\bai\b/i

export function isAiTrafficProxyGroupName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) {
    return false
  }
  return AI_TRAFFIC_GROUP_NAME_RE.test(trimmed)
}

/** Marathon Cursor HY2 leaf — must not appear in AI group member lists. */
export function isMarathonCursorHy2Leaf(node: string): boolean {
  const trimmed = node.trim()
  if (!trimmed) {
    return false
  }
  if (trimmed === MARATHON_CURSOR_OPTIMAL_VPS_NODE) {
    return true
  }
  return /-VPS-HY2$/i.test(trimmed)
}

export interface AiTrafficIsolationProxyGroup {
  name: string
  proxies?: string[]
}

export interface AiTrafficIsolationResult {
  groupsMutated: number
  proxiesRemoved: number
  removedLeaves: string[]
}

/**
 * Strip Marathon Cursor HY2 leaves from AI/Codex proxy groups so a HY2 byte-freeze
 * cannot co-kill Codex while commercial/Singapore paths remain healthy.
 */
export function excludeMarathonHy2FromAiProxyGroups(
  groups: AiTrafficIsolationProxyGroup[],
): AiTrafficIsolationResult {
  let groupsMutated = 0
  let proxiesRemoved = 0
  const removedLeaves = new Set<string>()
  for (const group of groups) {
    if (!isAiTrafficProxyGroupName(group.name) || !group.proxies?.length) {
      continue
    }
    const next = group.proxies.filter((proxy) => {
      if (!isMarathonCursorHy2Leaf(proxy)) {
        return true
      }
      removedLeaves.add(proxy.trim())
      proxiesRemoved += 1
      return false
    })
    if (next.length !== group.proxies.length) {
      group.proxies = next
      groupsMutated += 1
    }
  }
  return {
    groupsMutated,
    proxiesRemoved,
    removedLeaves: [...removedLeaves].sort(),
  }
}

export function formatAiTrafficIsolationLogLine(result: AiTrafficIsolationResult): string {
  return (
    `[AiTrafficIsolation]: outcome=${result.groupsMutated > 0 ? 'executed' : 'noop'}` +
    ` groups_mutated=${result.groupsMutated}` +
    ` proxies_removed=${result.proxiesRemoved}` +
    ` removed_leaves=${result.removedLeaves.join(',') || 'none'}\n`
  )
}
