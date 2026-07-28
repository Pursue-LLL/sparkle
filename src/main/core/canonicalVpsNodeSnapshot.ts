import { mihomoProxyProviders } from './mihomoApi'
import {
  collectCanonicalVpsNodeHistorySnapshotsFromProviders,
  collectCanonicalVpsNodeSnapshotsFromProviders,
  type VpsNodeHistorySnapshot,
  type VpsNodeProbeSnapshot
} from './canonicalVpsNodeSnapshotCore'

export type { VpsNodeHistorySnapshot, VpsNodeProbeSnapshot } from './canonicalVpsNodeSnapshotCore'

export async function collectCanonicalVpsNodeSnapshots(): Promise<VpsNodeProbeSnapshot[]> {
  try {
    const providers = await mihomoProxyProviders()
    return collectCanonicalVpsNodeSnapshotsFromProviders(providers)
  } catch {
    return []
  }
}

export async function collectCanonicalVpsNodeHistorySnapshots(): Promise<VpsNodeHistorySnapshot[]> {
  try {
    const providers = await mihomoProxyProviders()
    return collectCanonicalVpsNodeHistorySnapshotsFromProviders(providers)
  } catch {
    return []
  }
}
