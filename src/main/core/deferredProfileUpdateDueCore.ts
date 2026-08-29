// [INPUT] marathon guard snapshot · filesystem
// [OUTPUT] mark/read/clear deferred profile update due · execution eligibility
// [POS] BUG-2026-08-29-001 P2 — conn→0 后补跑被 marathon guard defer 的 subscription refresh

import type { MarathonCoreRestartGuardSnapshot } from './marathonCoreRestartGuardCore'
import { shouldBlockMarathonCoreColdRestart } from './marathonCoreRestartGuardCore'

export const DEFERRED_PROFILE_UPDATE_DUE_RELATIVE_PATH = '.sparkle/deferred-profile-update-due.json'

export interface DeferredProfileUpdateDueRecord {
  requestedAtMs: number
  source: 'profile-update-cli' | 'second-instance'
}

export function shouldExecuteDeferredProfileUpdateDue(
  snapshot: MarathonCoreRestartGuardSnapshot,
): boolean {
  const decision = shouldBlockMarathonCoreColdRestart(snapshot, false)
  return !decision.blocked
}

export function parseDeferredProfileUpdateDueRecord(raw: string): DeferredProfileUpdateDueRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as DeferredProfileUpdateDueRecord).requestedAtMs === 'number' &&
      (((parsed as DeferredProfileUpdateDueRecord).source === 'profile-update-cli') ||
        (parsed as DeferredProfileUpdateDueRecord).source === 'second-instance')
    ) {
      return parsed as DeferredProfileUpdateDueRecord
    }
  } catch {
    return null
  }
  return null
}

export function serializeDeferredProfileUpdateDueRecord(
  record: DeferredProfileUpdateDueRecord,
): string {
  return `${JSON.stringify(record)}\n`
}
