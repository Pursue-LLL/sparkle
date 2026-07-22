import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { readCursorDedicatedManualSelection } from './cursorDedicatedSelectionCore'
import type { MihomoAutoSwitchApi } from './defaultAutoSwitchProxy'

export const CURSOR_DEFAULT_VPS_NODE = 'JP-VPS-TLS' as const

const CURSOR_PREFERRED_VPS_NODES = [CURSOR_DEFAULT_VPS_NODE] as const

/** Never auto-select transports that can reintroduce QUIC or Reality handshake failure modes. */
export function isCursorSuboptimalNode(name: string): boolean {
  return /-VPS-(Reality|TUIC|HY2)$/i.test(name)
}

/** Allow a one-way upgrade to trusted standard TLS even when the short api2 probe is green. */
export function isCursorProtocolUpgrade(from: string, to: string): boolean {
  return isCursorSuboptimalNode(from) && !isCursorSuboptimalNode(to)
}

/** Only seed the default when the Cursor group has no real selection yet. */
export function shouldApplyCursorDedicatedDefault(current: string | undefined): boolean {
  return !current || current === 'SDK DNS'
}

/** Never auto-upgrade Dedicated protocol (HY2/TUIC/Reality → TLS) on bootstrap — avoids implicit tunnel rebuild. */
export function shouldUpgradeCursorDedicatedNode(
  _current: string | undefined,
  _targetNode: string,
  _manualSelection?: string
): boolean {
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
  const current = cursorGroup.now
  const manualSelection = await readCursorDedicatedManualSelection()

  if (manualSelection && available.has(manualSelection)) {
    if (current === manualSelection) {
      return false
    }
    const restored = await changeProxyApi(CURSOR_DEDICATED_GROUP_NAME, manualSelection, {
      source: 'bootstrap'
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

  if (current === targetNode) {
    return false
  }

  if (!shouldUpgradeCursorDedicatedNode(current, targetNode, manualSelection)) {
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
