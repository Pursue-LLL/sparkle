/** Managed VPS transports — Seoul KR HY2 only (2026-09-04). */
export const CANONICAL_VPS_NODE_PATTERN = /^KR-VPS-HY2(-\S+)?$/i

export type ActiveVpsRegion = 'KR-VPS'

export const CANONICAL_VPS_LEAVES_BY_REGION: Readonly<Record<ActiveVpsRegion, readonly string[]>> = {
  'KR-VPS': ['KR-VPS-HY2'],
}

export function isCanonicalVpsNodeName(name: string): boolean {
  return CANONICAL_VPS_NODE_PATTERN.test(name)
}

export function isVpsRegionNodeName(name: string): boolean {
  return name === 'KR-VPS'
}

/** Map leaf (KR-VPS-HY2) or region (KR-VPS) to SSH L4 ledger region key. */
export function resolveVpsRegionFromLeafNode(nodeName: string): ActiveVpsRegion | null {
  const trimmed = nodeName.trim()
  if (trimmed === 'KR-VPS' || trimmed === 'KR-VPS-HY2') {
    return 'KR-VPS'
  }
  return null
}
