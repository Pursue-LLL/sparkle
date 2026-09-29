// [INPUT] failed leaf · available Cursor dedicated members
// [OUTPUT] resolveLeafFailoverTarget
// [POS] Pure-Pipe — Cursor dedicated traffic stays on dedicated VPS or DIRECT; never falls back to unstable public pool.

export const CURSOR_LEAF_FAILOVER_PREFERENCE = ['DIRECT'] as const

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
  return undefined
}
