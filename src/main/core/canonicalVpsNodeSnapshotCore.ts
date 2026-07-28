import { isCanonicalVpsNodeName } from './vpsCanonicalNodes'
import { pickLatestSuccessfulProviderDelay } from './mihomoProviderDelayCore'

export interface VpsNodeProbeSnapshot {
  name: string
  delay: number
  time: string
  alive?: boolean
}

export interface VpsNodeHistoryEntry {
  time: string
  delay: number
}

export interface VpsNodeHistorySnapshot {
  name: string
  alive?: boolean
  history: VpsNodeHistoryEntry[]
}

/** Matches mihomo UI last-N history bars (V5.6 triage @ A). */
export const MIHOMO_UI_HISTORY_TAIL = 8

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

function normalizeHistoryTail(
  history: ProviderProxyHistoryEntry[]
): VpsNodeHistoryEntry[] {
  return history
    .slice(-MIHOMO_UI_HISTORY_TAIL)
    .filter(
      (entry): entry is ProviderProxyHistoryEntry & { time: string; delay: number } =>
        typeof entry.time === 'string' && typeof entry.delay === 'number'
    )
    .map((entry) => ({ time: entry.time, delay: entry.delay }))
}

export function collectCanonicalVpsNodeHistorySnapshotsFromProviders(
  payload: ProviderProxiesPayload
): VpsNodeHistorySnapshot[] {
  const snapshots: VpsNodeHistorySnapshot[] = []
  for (const provider of Object.values(payload.providers ?? {})) {
    for (const leaf of provider.proxies ?? []) {
      if (!isCanonicalVpsNodeName(leaf.name)) {
        continue
      }
      const history = normalizeHistoryTail(leaf.history ?? [])
      if (history.length === 0) {
        continue
      }
      snapshots.push({
        name: leaf.name,
        alive: leaf.alive,
        history
      })
    }
  }
  snapshots.sort((left, right) => left.name.localeCompare(right.name))
  return snapshots
}
