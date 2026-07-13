/** Canonical VPS nodes: KR/JP × Reality/HY2/TUIC (with optional suffix, case-insensitive) */
export const CANONICAL_VPS_NODE_PATTERN = /^(KR|JP)-VPS-(Reality|HY2|TUIC)(-\S+)?$/i

export function isCanonicalVpsNodeName(name: string): boolean {
  return CANONICAL_VPS_NODE_PATTERN.test(name)
}
