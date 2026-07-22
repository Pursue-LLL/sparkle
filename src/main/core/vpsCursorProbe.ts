import { mihomoProxies } from './mihomoApi'
import { isCanonicalVpsNodeName } from './vpsCanonicalNodes'

export { CANONICAL_VPS_NODE_PATTERN, isCanonicalVpsNodeName } from './vpsCanonicalNodes'

function resolveVpsRegion(nodeName: string): string {
  if (nodeName.startsWith('KR-')) return 'KR-VPS'
  if (nodeName.startsWith('JP-')) return 'JP-VPS'
  return 'VPS'
}

/** Managed VPS nodes for transport diagnostics, including trusted standard TLS. */
export function isVpsCursorProbeRunning(): boolean {
  return false
}

export async function listCanonicalVpsNodes(): Promise<
  Array<{ name: string; region: string; kind: 'vps' }>
> {
  const proxies = await mihomoProxies()
  const nodes: Array<{ name: string; region: string; kind: 'vps' }> = []
  for (const [name, entry] of Object.entries(proxies.proxies)) {
    if (!isCanonicalVpsNodeName(name)) continue
    if ('all' in entry) continue
    nodes.push({ name, region: resolveVpsRegion(name), kind: 'vps' })
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name))
  return nodes
}

export async function startVpsCursorProbe(): Promise<void> {
  // No-op: canonical VPS nodes are probed by CommercialNodeBenchmark.
}

export function stopVpsCursorProbe(): void {
  // No-op: kept for IPC / dev bootstrap compatibility.
}

export async function restartVpsCursorProbe(): Promise<void> {
  // No-op: kept for IPC compatibility.
}
