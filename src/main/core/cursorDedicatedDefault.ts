import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { readCursorDedicatedManualSelection } from './cursorDedicatedSelectionCore'
import type { MihomoAutoSwitchApi } from './defaultAutoSwitchProxy'

export const CURSOR_DEFAULT_VPS_NODE = 'KR-VPS-Reality' as const

/** Only seed the default when the Cursor group has no real selection yet. */
export function shouldApplyCursorDedicatedDefault(current: string | undefined): boolean {
  return !current || current === 'SDK DNS'
}

export function resolveCursorDefaultVpsNode(available: ReadonlySet<string>): string | undefined {
  if (available.has(CURSOR_DEFAULT_VPS_NODE)) {
    return CURSOR_DEFAULT_VPS_NODE
  }
  return undefined
}

export async function applyCursorDedicatedVpsSelection(
  api: Pick<MihomoAutoSwitchApi, 'mihomoGroups' | 'mihomoChangeProxy'>
): Promise<boolean> {
  const { mihomoGroups: groupsApi, mihomoChangeProxy: changeProxyApi } = api
  if (typeof groupsApi !== 'function' || typeof changeProxyApi !== 'function') {
    throw new Error('mihomoApi exports missing: mihomoGroups/mihomoChangeProxy')
  }
  const { appendAppLog } = await import('../utils/log')

  const groups = await groupsApi()
  if (!groups?.length) {
    return false
  }

  const cursorGroup = groups.find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
  if (!cursorGroup) {
    return false
  }

  const memberNames = cursorGroup.all
    .map((proxy) => proxy?.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
  const available = new Set(memberNames)
  const current = cursorGroup.now
  const manualSelection = await readCursorDedicatedManualSelection()

  if (manualSelection && available.has(manualSelection)) {
    if (current === manualSelection) {
      return false
    }
    const restored = await changeProxyApi(CURSOR_DEDICATED_GROUP_NAME, manualSelection, {
      source: 'manual'
    })
    if (restored) {
      await appendAppLog(
        `[CursorDedicatedDefault]: restore manual selection → ${manualSelection}\n`
      )
      return true
    }
    return false
  }

  const targetNode = resolveCursorDefaultVpsNode(available)
  if (!targetNode) {
    await appendAppLog(
      `[CursorDedicatedDefault]: skip — no trusted standard TLS VPS node in group.all (${memberNames.length} members: ${memberNames.join(', ')})\n`
    )
    return false
  }

  if (!shouldApplyCursorDedicatedDefault(current)) {
    return false
  }

  const result = await changeProxyApi(CURSOR_DEDICATED_GROUP_NAME, targetNode, {
    source: 'bootstrap'
  })
  if (!result) {
    return false
  }
  await appendAppLog(`[CursorDedicatedDefault]: ${CURSOR_DEDICATED_GROUP_NAME} → ${targetNode}\n`)
  return true
}
