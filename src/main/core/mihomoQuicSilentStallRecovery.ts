// [INPUT] mihomoQuicSilentStallRecoveryCore · hy2TunnelVitality · mihomoApi
// [OUTPUT] executeMihomoQuicStallRecoveryIfDue
// [POS] R-33 runtime — stall-triggered vitality dial + optional single mihomo connection close.

import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import { appendAppLog } from '../utils/log'
import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import {
  formatMihomoQuicStallRecoveryLogLine,
  resolveMihomoQuicStallRecoveryPlan,
  type MihomoQuicStallRecoveryAction,
} from './mihomoQuicSilentStallRecoveryCore'

const lastRecoveryAtMsByConnectionId = new Map<string, number>()
let skipRecoveryAppLogForTests = false

export function resetMihomoQuicSilentStallRecoveryForTests(): void {
  lastRecoveryAtMsByConnectionId.clear()
  skipRecoveryAppLogForTests = false
}

export function setSkipMihomoQuicSilentStallRecoveryAppLogForTests(skip: boolean): void {
  skipRecoveryAppLogForTests = skip
}

async function logRecovery(line: string): Promise<void> {
  if (skipRecoveryAppLogForTests) {
    return
  }
  await appendAppLog(line)
}

async function runStallVitalityDial(
  leaf: string,
  cursorConnectionCount: number,
  nowMs: number,
): Promise<{ ok: boolean; delayMs?: number; err?: string }> {
  try {
    const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
    const truth = await resolveMarathonSSETruthNow(cursorConnectionCount)
    const { runHy2TunnelVitalityIfDue } = await import('./hy2TunnelVitality')
    const result = await runHy2TunnelVitalityIfDue(leaf, cursorConnectionCount, nowMs, truth, {
      stallRecoveryBypass: true,
    })
    if (result.outcome === 'executed') {
      return { ok: true, delayMs: result.connectPathDelayMs }
    }
    if (result.outcome === 'skipped_in_flight' || result.outcome === 'skipped_not_due') {
      return { ok: true, delayMs: result.connectPathDelayMs }
    }
    return { ok: false, err: result.outcome }
  } catch (error) {
    return { ok: false, err: formatUnknownErrorForLog(error) }
  }
}

async function closeStalledConnection(connectionId: string): Promise<{ ok: boolean; err?: string }> {
  try {
    const { mihomoCloseConnection } = await import('./mihomoApi')
    await mihomoCloseConnection(connectionId)
    return { ok: true }
  } catch (error) {
    return { ok: false, err: formatUnknownErrorForLog(error) }
  }
}

function markRecovery(connectionId: string | undefined, nowMs: number): void {
  if (!connectionId) {
    return
  }
  lastRecoveryAtMsByConnectionId.set(connectionId, nowMs)
}

export async function executeMihomoQuicStallRecoveryIfDue(
  observation: MihomoQuicSilentStallObservation,
  nowMs: number = Date.now(),
): Promise<MihomoQuicStallRecoveryAction> {
  const plan = resolveMihomoQuicStallRecoveryPlan({
    observation,
    lastRecoveryAtMsByConnectionId,
    nowMs,
  })
  if (plan.action === 'none') {
    await logRecovery(
      formatMihomoQuicStallRecoveryLogLine({
        outcome: 'skipped',
        action: plan.action,
        reason: plan.reason,
        leaf: observation.leaf,
        stallMs: observation.stallMs,
        cursorConnectionCount: observation.cursorConnectionCount,
        connectionId: observation.connectionId,
        host: observation.host,
      }),
    )
    return plan.action
  }

  if (plan.action === 'vitality_dial') {
    const vitality = await runStallVitalityDial(
      observation.leaf,
      observation.cursorConnectionCount,
      nowMs,
    )
    markRecovery(observation.connectionId, nowMs)
    await logRecovery(
      formatMihomoQuicStallRecoveryLogLine({
        outcome: vitality.ok ? 'executed' : 'failed',
        action: plan.action,
        reason: plan.reason,
        leaf: observation.leaf,
        stallMs: observation.stallMs,
        cursorConnectionCount: observation.cursorConnectionCount,
        connectionId: observation.connectionId,
        host: observation.host,
        vitalityDelayMs: vitality.delayMs,
        err: vitality.err,
      }),
    )
    return plan.action
  }

  const closed = await closeStalledConnection(observation.connectionId ?? '')
  markRecovery(observation.connectionId, nowMs)
  await logRecovery(
    formatMihomoQuicStallRecoveryLogLine({
      outcome: closed.ok ? 'executed' : 'failed',
      action: plan.action,
      reason: plan.reason,
      leaf: observation.leaf,
      stallMs: observation.stallMs,
      cursorConnectionCount: observation.cursorConnectionCount,
      connectionId: observation.connectionId,
      host: observation.host,
      err: closed.err,
    }),
  )
  if (closed.ok) {
    await runStallVitalityDial(observation.leaf, observation.cursorConnectionCount, nowMs)
  }
  return plan.action
}
