import { mihomoProxyProviders } from './mihomoApi'
import {
  collectCanonicalVpsNodeSnapshotsFromProviders,
  type VpsNodeProbeSnapshot
} from './canonicalVpsNodeSnapshotCore'

export type { VpsNodeProbeSnapshot } from './canonicalVpsNodeSnapshotCore'

export async function collectCanonicalVpsNodeSnapshots(): Promise<VpsNodeProbeSnapshot[]> {
  try {
    const providers = await mihomoProxyProviders()
    return collectCanonicalVpsNodeSnapshotsFromProviders(providers)
  } catch {
    return []
  }
}
