import { isCanonicalVpsNodeName } from './vpsCanonicalNodes'
import { pickLatestSuccessfulProviderDelay } from './mihomoProviderDelayCore'

export interface VpsNodeProbeSnapshot {
  name: string
  delay: number
  time: string
  alive?: boolean
}

interface ProviderProxyHistoryEntry {
  time?: string
  delay?: number
}

interface ProviderProxyLeaf {
  name: string
  alive?: boolean
  history?: ProviderProxyHistoryEntry[]
}

interface ProviderProxiesPayload {
  providers?: Record<
    string,
    {
      proxies?: ProviderProxyLeaf[]
    }
  >
}

export function collectCanonicalVpsNodeSnapshotsFromProviders(
  payload: ProviderProxiesPayload
): VpsNodeProbeSnapshot[] {
  const snapshots: VpsNodeProbeSnapshot[] = []
  for (const provider of Object.values(payload.providers ?? {})) {
    for (const leaf of provider.proxies ?? []) {
      if (!isCanonicalVpsNodeName(leaf.name)) {
        continue
      }
      const latest = pickLatestSuccessfulProviderDelay(leaf.history ?? [])
      if (!latest) {
        continue
      }
      snapshots.push({
        name: leaf.name,
        delay: latest.delay,
        time: latest.time,
        alive: leaf.alive
      })
    }
  }
  snapshots.sort((left, right) => left.name.localeCompare(right.name))
  return snapshots
}
