/** Managed KR/JP VPS transports, including trusted standard TLS. */
export const CANONICAL_VPS_NODE_PATTERN = /^(KR|JP)-VPS-(Reality|TLS|HY2|TUIC)(-\S+)?$/i

export function isCanonicalVpsNodeName(name: string): boolean {
  return CANONICAL_VPS_NODE_PATTERN.test(name)
}
