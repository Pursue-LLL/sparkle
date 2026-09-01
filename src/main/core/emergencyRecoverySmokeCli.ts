// [INPUT] emergencyCoreRecovery · manager
// [OUTPUT] runEmergencyRecoverySmokeCli
// [POS] Live smoke — T0-verifiable emergency path after install.

import { appendAppLog } from '../utils/log'

export const EMERGENCY_RECOVERY_SMOKE_ARG = '--sparkle-emergency-recovery-smoke'

export async function runEmergencyRecoverySmokeCli(): Promise<void> {
  const startedAtMs = Date.now()
  await appendAppLog('[EmergencyRecoverySmoke]: begin\n')

  await import('./manager')
  const { requestEmergencyCoreRecovery } = await import('./emergencyCoreRecovery')
  const result = await requestEmergencyCoreRecovery({
    reason: 'byte_death_circuit_open',
    leafId: 'JP-VPS-HY2',
    evidenceReason: 'recovery_circuit_breaker_open',
    cursorConnectionCount: 0,
    nowMs: startedAtMs,
  })

  await appendAppLog(
    `[EmergencyRecoverySmoke]: outcome=${result.executed ? 'PASS' : 'FAIL'} reason=${result.reason} elapsed_ms=${Date.now() - startedAtMs}\n`,
  )

  if (!result.executed) {
    throw new Error(`emergency_recovery_smoke_failed:${result.reason}`)
  }
}
