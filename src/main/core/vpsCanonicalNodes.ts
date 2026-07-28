/** Managed JP VPS transports, including trusted standard TLS. KR-VPS decommissioned 2026-07-24. */
export const CANONICAL_VPS_NODE_PATTERN = /^JP-VPS-(Reality|TLS|HY2|TUIC)(-\S+)?$/i

export type ActiveVpsRegion = 'JP-VPS'

export const CANONICAL_VPS_LEAVES_BY_REGION: Readonly<Record<ActiveVpsRegion, readonly string[]>> = {
  'JP-VPS': ['JP-VPS-Reality', 'JP-VPS-TLS', 'JP-VPS-HY2', 'JP-VPS-TUIC'],
}

export function isCanonicalVpsNodeName(name: string): boolean {
  return CANONICAL_VPS_NODE_PATTERN.test(name)
}

export function isVpsRegionNodeName(name: string): boolean {
  return name === 'JP-VPS'
}

/** Map leaf (JP-VPS-HY2) or region (JP-VPS) to SSH L4 ledger region key. Legacy KR-* returns null. */
export function resolveVpsRegionFromLeafNode(nodeName: string): ActiveVpsRegion | null {
  const trimmed = nodeName.trim()
  if (trimmed === 'JP-VPS') {
    return 'JP-VPS'
  }
  if (!isCanonicalVpsNodeName(trimmed)) {
    return null
  }
  return 'JP-VPS'
}
