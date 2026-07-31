/** Detect zombie /tmp/sparkle-mihomo-api.sock that blocks direct controller bind. */

export interface StaleMihomoApiSocketInput {
  exists: boolean
  probeError: string | null
}

export function shouldRemoveStaleMihomoApiSocket(input: StaleMihomoApiSocketInput): boolean {
  if (!input.exists) {
    return false
  }
  if (!input.probeError) {
    return false
  }
  const normalized = input.probeError.toLowerCase()
  return (
    normalized.includes('econnrefused') ||
    normalized.includes('enotconn') ||
    normalized.includes('socket hang up')
  )
}

export function formatStaleMihomoApiSocketAction(
  socketPath: string,
  input: StaleMihomoApiSocketInput,
): string | null {
  if (!shouldRemoveStaleMihomoApiSocket(input)) {
    return null
  }
  return `remove stale mihomo api socket ${socketPath} (${input.probeError})`
}
