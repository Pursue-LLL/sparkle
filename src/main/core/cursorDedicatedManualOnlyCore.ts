// [INPUT] MihomoChangeProxySource · current Cursor dedicated selection
// [OUTPUT] isCursorDedicatedManualOnlySwitchAllowed
// [POS] Cursor 专用 — selector only; no recovery/failover/auto-hop node changes.

import type { MihomoChangeProxySource } from './mihomoApi'
import { shouldApplyCursorDedicatedDefault } from './cursorDedicatedDefault'

export function isCursorDedicatedManualOnlySwitchAllowed(input: {
  source: MihomoChangeProxySource
  fromNode: string | undefined
}): boolean {
  if (input.source === 'manual') {
    return true
  }
  if (
    input.source === 'bootstrap' &&
    shouldApplyCursorDedicatedDefault(input.fromNode?.trim() || undefined)
  ) {
    return true
  }
  return false
}

export function formatCursorDedicatedManualOnlyBlockedLogLine(input: {
  source: MihomoChangeProxySource
  fromNode: string
  toNode: string
}): string {
  return (
    `[CursorDedicatedManualOnly]: outcome=blocked source=${input.source} ` +
    `from=${input.fromNode} to=${input.toNode} reason=cursor_dedicated_manual_only\n`
  )
}
