// [INPUT] transportLongevityTruth · hy2ParentSidecar · emergencyCoreRecovery
// [OUTPUT] runProactiveHy2HardRotateIfDue
// [POS] BUG-2026-09-03-011 — 4h stale HY2 session hard rotate with api2 anchor.

import { appendAppLog } from '../utils/log'
import { mihomoGetConnections } from './mihomoApi'
import {
  HY2_PARENT_SIDECAR_DIAL_AGE_MS,
  resolveEffectiveHy2ParentChainAgeMs,
} from './hy2ParentSidecarCore'
import { measuredLongflowEvidence } from './proxyStackDeadlockCore'

let proactiveRotateInFlight = false
let lastProactiveRotateAtMs = 0
const PROACTIVE_ROTATE_COOLDOWN_MS = 30 * 60_000

export function resetProactiveHy2HardRotateForTests(nowMs = Date.now()): void {
  proactiveRotateInFlight = false
  lastProactiveRotateAtMs = nowMs - PROACTIVE_ROTATE_COOLDOWN_MS - 1
}

export async function runProactiveHy2HardRotateIfDue(nowMs?: number): Promise<void> {
  const atMs = nowMs ?? Date.now()
  if (proactiveRotateInFlight) {
    return
  }
  if (atMs - lastProactiveRotateAtMs < PROACTIVE_ROTATE_COOLDOWN_MS) {
    return
  }
  const { readTransportLongevityTruthSnapshot } = await import('./transportLongevityTruth')
  const snapshot = await readTransportLongevityTruthSnapshot()
  if (!snapshot) {
    return
  }
  const chainAgeMs = resolveEffectiveHy2ParentChainAgeMs(snapshot, atMs)
  if (chainAgeMs < HY2_PARENT_SIDECAR_DIAL_AGE_MS) {
    return
  }
  proactiveRotateInFlight = true
  lastProactiveRotateAtMs = atMs
  try {
    await appendAppLog(
      `[ProactiveHy2HardRotate]: outcome=planned action=proactive_hard_rotate ` +
        `http_parent_chain_age_ms=${snapshot.httpParentChainAgeMs} ` +
        `outbound_hy2_session_age_ms=${snapshot.outboundHy2SessionAgeMs} ` +
        `effective_chain_age_ms=${chainAgeMs} ` +
        `cursor_conn=${snapshot.cursorConnectionCount}\n`,
    )
    const connectionPayload = await mihomoGetConnections()
    const connections = connectionPayload.connections ?? []
    const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
    const marathonTruth = await resolveMarathonSSETruthNow(snapshot.cursorConnectionCount)
    const { runHy2ParentSidecarIfDue } = await import('./hy2ParentSidecar')
    const sidecar = await runHy2ParentSidecarIfDue({
      snapshot,
      connections,
      trackedFirstSeenAtMsById: new Map(),
      trackedLastByteChangeAtMsById: new Map(),
      marathonTruth,
      cursorConnectionCount: snapshot.cursorConnectionCount,
      nowMs: atMs,
      proactiveHardRotate: true,
      emergencyStallEscalation: true,
      recoveryIneffective: true,
    })
    if (sidecar.outcome === 'executed') {
      await appendAppLog(
        `[ProactiveHy2HardRotate]: outcome=executed action=${sidecar.action} reason=${sidecar.reason}\n`,
      )
      return
    }
    const { requestEmergencyCoreRecovery } = await import('./emergencyCoreRecovery')
    const emergency = await requestEmergencyCoreRecovery({
      reason: 'proactive_hard_rotate_failed',
      leafId: snapshot.activeHy2Leaf?.trim() ?? 'KR-VPS-HY2',
      evidenceReason: 'proactive_hard_rotate_api2_anchor',
      cursorConnectionCount: snapshot.cursorConnectionCount,
      longflow: measuredLongflowEvidence({
        maxByteStallMs: snapshot.maxByteStallMs,
        frozenQuicCursorCount: snapshot.frozenQuicCursorCount,
        cursorConnectionCount: snapshot.cursorConnectionCount,
      }),
      nowMs: atMs,
    })
    await appendAppLog(
      `[ProactiveHy2HardRotate]: outcome=${emergency.executed ? 'executed' : 'failed'} ` +
        `action=emergency_core_recovery reason=${emergency.reason}\n`,
    )
  } finally {
    proactiveRotateInFlight = false
  }
}
