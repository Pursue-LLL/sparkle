import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import type { MihomoAutoSwitchApi } from './defaultAutoSwitchProxy'

export const CURSOR_DEFAULT_VPS_NODE = 'KR-VPS-Reality' as const

const CURSOR_PREFERRED_VPS_NODES = [
  CURSOR_DEFAULT_VPS_NODE,
  'JP-VPS-Reality'
] as const

/** UDP leaf nodes are unstable for marathon SSE; prefer TCP Reality. */
export function isCursorSuboptimalNode(name: string): boolean {
  return /-VPS-(TUIC|HY2)$/i.test(name)
}

/** Only seed the default when the Cursor group has no real selection yet. */
export function shouldApplyCursorDedicatedDefault(current: string | undefined): boolean {
  return !current || current === 'SDK DNS'
}

/** Upgrade dedicated group selection to the marathon-stable Reality default when needed. */
export function shouldUpgradeCursorDedicatedNode(
  current: string | undefined,
  targetNode: string
): boolean {
  if (shouldApplyCursorDedicatedDefault(current)) {
    return true
  }
  if (current && isCursorSuboptimalNode(current)) {
    return true
  }
  if (current === 'JP-VPS-Reality' && targetNode === CURSOR_DEFAULT_VPS_NODE) {
    return true
  }
  return false
}

export function resolveCursorDefaultVpsNode(available: ReadonlySet<string>): string | undefined {
  for (const node of CURSOR_PREFERRED_VPS_NODES) {
    if (available.has(node)) {
      return node
    }
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
  const targetNode = resolveCursorDefaultVpsNode(available)
  if (!targetNode) {
    await appendAppLog(
      `[CursorDedicatedDefault]: skip — no preferred VPS Reality node in group.all (${memberNames.length} members: ${memberNames.join(', ')})\n`
    )
    return false
  }

  const current = cursorGroup.now
  if (current === targetNode) {
    return false
  }

  if (!shouldUpgradeCursorDedicatedNode(current, targetNode)) {
    return false
  }

  const result = await changeProxyApi(CURSOR_DEDICATED_GROUP_NAME, targetNode, {
    source: 'auto'
  })
  if (!result) {
    return false
  }
  await appendAppLog(
    `[CursorDedicatedDefault]: ${CURSOR_DEDICATED_GROUP_NAME} → ${targetNode}\n`
  )
  return true
}
