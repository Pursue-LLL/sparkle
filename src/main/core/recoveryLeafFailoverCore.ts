// [INPUT] failed leaf · available Cursor dedicated members
// [OUTPUT] resolveLeafFailoverTarget
// [POS] HY2-only VPS — failover to 自动选择 or DIRECT (no JP TCP leaves).

export const CURSOR_LEAF_FAILOVER_PREFERENCE = ['自动选择', 'DIRECT'] as const

export function resolveLeafFailoverTarget(input: {
  failedLeafId: string
  availableMembers: readonly string[]
}): string | undefined {
  const failed = input.failedLeafId.trim()
  const available = new Set(
    input.availableMembers.map((member) => member.trim()).filter((member) => member.length > 0),
  )
  for (const candidate of CURSOR_LEAF_FAILOVER_PREFERENCE) {
    if (candidate !== failed && available.has(candidate)) {
      return candidate
    }
  }
  for (const member of available) {
    if (member !== failed && !member.includes(failed)) {
      return member
    }
  }
  return undefined
}
