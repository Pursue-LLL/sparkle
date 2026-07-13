import {
  CURSOR_DEDICATED_GROUP_NAME,
  isAutoSwitchingProxyName,
  isNestedAutoSwitchSelection
} from './cursorProxyGroup'
import type { MihomoAutoSwitchApi } from './defaultAutoSwitchProxy'

export const CURSOR_DEFAULT_VPS_NODE = 'KR-VPS-TUIC' as const

/** HY2/JP paths show high Agent RST or probe failure in 24h benchmarks — always prefer TUIC. */
function isCursorSuboptimalNode(name: string): boolean {
  if (/^KR-VPS-HY2$/i.test(name)) {
    return true
  }
  if (/^JP-VPS-/i.test(name)) {
    return true
  }
  return false
}

export async function applyCursorDedicatedVpsSelection(
  api?: Pick<MihomoAutoSwitchApi, 'mihomoGroups' | 'mihomoChangeProxy'>
): Promise<boolean> {
  const mod = api ?? (await import('./mihomoApi'))
  const { mihomoGroups, mihomoChangeProxy } = mod
  const { appendAppLog } = await import('../utils/log')

  const groups = await mihomoGroups()
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
  if (!available.has(CURSOR_DEFAULT_VPS_NODE)) {
    await appendAppLog(
      `[CursorDedicatedDefault]: skip — ${CURSOR_DEFAULT_VPS_NODE} not in group.all (${memberNames.length} members: ${memberNames.join(', ')})\n`
    )
    return false
  }

  const current = cursorGroup.now
  if (current === CURSOR_DEFAULT_VPS_NODE) {
    return false
  }

  const shouldReplace =
    !current ||
    isAutoSwitchingProxyName(current) ||
    isNestedAutoSwitchSelection(current, groups) ||
    current === 'SDK DNS' ||
    isCursorSuboptimalNode(current)

  if (!shouldReplace) {
    return false
  }

  await mihomoChangeProxy(CURSOR_DEDICATED_GROUP_NAME, CURSOR_DEFAULT_VPS_NODE, {
    source: 'auto'
  })
  await appendAppLog(
    `[CursorDedicatedDefault]: ${CURSOR_DEDICATED_GROUP_NAME} → ${CURSOR_DEFAULT_VPS_NODE}\n`
  )
  return true
}
