// [INPUT] marathon lifecycle + dial admission guards
// [OUTPUT] runP10ActiveUnknownMutationNegativeGate
// [POS] P10-2 Gate 2 — ACTIVE lifecycle must block/defer every inventoried data-plane mutation caller.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldDeferAppConfigMihomoReload, shouldDeferProfileProviderReload } from './appConfigMihomoReloadGuardCore'
import { shouldBlockMarathonCoreColdRestart } from './marathonCoreRestartGuardCore'
import {
  createInitialDialAdmissionState,
  markDialAdmissionOutcome,
  resolveDialAdmission,
} from './dialAdmissionArbiterCore'
import { P10_DIAL_CAPABILITY_INVENTORY } from './dialCapabilityInventoryCore'

export const P10_ACTIVE_LIFECYCLE_SNAPSHOT = {
  quiesceActive: false,
  cursorConnectionCount: 0,
  recentActiveLifecycleStreamCount: 2,
} as const

export const P10_UNKNOWN_IDLE_SNAPSHOT = {
  quiesceActive: false,
  cursorConnectionCount: 0,
  recentActiveLifecycleStreamCount: 0,
} as const

export interface P10ActiveUnknownNegativeCaseResult {
  caller: string
  ok: boolean
  detail: string
}

export interface P10ActiveUnknownMutationNegativeGateResult {
  ok: boolean
  inventoryModules: number
  cases: P10ActiveUnknownNegativeCaseResult[]
}

export function runP10ActiveUnknownMutationNegativeGate(): P10ActiveUnknownMutationNegativeGateResult {
  const cases: P10ActiveUnknownNegativeCaseResult[] = []

  const activeDefer = shouldDeferAppConfigMihomoReload(P10_ACTIVE_LIFECYCLE_SNAPSHOT)
  const idleAllow = !shouldDeferAppConfigMihomoReload(P10_UNKNOWN_IDLE_SNAPSHOT)
  cases.push({
    caller: 'ipc.ts/app_config_mihomo_reload',
    ok: activeDefer && idleAllow,
    detail: activeDefer ? 'active lifecycle defers reload' : 'failed to defer under active lifecycle',
  })

  const profileActiveDefer = shouldDeferProfileProviderReload(P10_ACTIVE_LIFECYCLE_SNAPSHOT)
  const profileIdleAllow = !shouldDeferProfileProviderReload(P10_UNKNOWN_IDLE_SNAPSHOT)
  cases.push({
    caller: 'profile.ts/profile_save_provider_reload',
    ok: profileActiveDefer && profileIdleAllow,
    detail: profileActiveDefer ? 'profile reload deferred under active lifecycle' : 'profile bypass',
  })

  const coreBlocked = shouldBlockMarathonCoreColdRestart(
    {
      ...P10_ACTIVE_LIFECYCLE_SNAPSHOT,
      updatedAtMs: Date.now(),
    },
    false,
  )
  cases.push({
    caller: 'manager.ts/core_cold_restart',
    ok: coreBlocked.blocked && coreBlocked.reason === 'recent_active_lifecycle_stream',
    detail: coreBlocked.reason,
  })

  let admissionState = createInitialDialAdmissionState()
  const incident = 'active-lifecycle:orig-x:1'
  const firstDial = resolveDialAdmission(admissionState, {
    dialId: 'neg-d1',
    class: 'active_recovery',
    caller: 'marathonRescueDialExecutor.ts',
    incidentGeneration: incident,
    submittedAtMs: 1,
  })
  admissionState = firstDial.nextState
  const secondDial = resolveDialAdmission(admissionState, {
    dialId: 'neg-d2',
    class: 'active_recovery',
    caller: 'marathonWarmthDialExecutor.ts',
    incidentGeneration: incident,
    submittedAtMs: 2,
  })
  cases.push({
    caller: 'dial executors/global_control_inflight',
    ok: firstDial.admitted && !secondDial.admitted,
    detail: secondDial.reason,
  })

  admissionState = markDialAdmissionOutcome(admissionState, 'neg-d1', incident, 'INEFFECTIVE')
  const thirdDial = resolveDialAdmission(admissionState, {
    dialId: 'neg-d3',
    class: 'active_recovery',
    caller: 'marathonTransportDialOrchestrator.ts',
    incidentGeneration: incident,
    submittedAtMs: 3,
  })
  cases.push({
    caller: 'dial executors/post_ineffective_still_single_flight',
    ok: !thirdDial.admitted,
    detail: thirdDial.reason,
  })

  cases.push({
    caller: 'hy2ParentSidecar.ts/passive_detect_only',
    ok: (() => {
      const coreDir = dirname(fileURLToPath(import.meta.url))
      const source = readFileSync(join(coreDir, 'hy2ParentSidecar.ts'), 'utf8')
      return (
        !source.includes('executeMarathonRescueDial') &&
        !source.includes('mihomoCloseConnection') &&
        source.includes('phase=detect_only')
      )
    })(),
    detail: 'R-35 sidecar passive-only — zero dial/close under ACTIVE',
  })

  cases.push({
    caller: 'mihomoQuicSilentStallRecovery.ts/frozen_prune_marathon_gate',
    ok: (() => {
      const coreDir = dirname(fileURLToPath(import.meta.url))
      const source = readFileSync(join(coreDir, 'mihomoQuicSilentStallRecovery.ts'), 'utf8')
      return (
        source.includes('resolveFrozenSurgicalPrunePlan') &&
        source.includes('marathonActive: latestMarathonRecoveryContext.marathonActive')
      )
    })(),
    detail: 'R-34 prune path wired to marathonActive context',
  })

  cases.push({
    caller: 'cursorHy2MarathonKeepalive.ts/rescue_delegates_executor',
    ok: (() => {
      const coreDir = dirname(fileURLToPath(import.meta.url))
      const source = readFileSync(join(coreDir, 'cursorHy2MarathonKeepalive.ts'), 'utf8')
      return source.includes('executeMarathonRescueDial') && source.includes('executeMarathonWarmthDial')
    })(),
    detail: 'keepalive facade delegates to P19 dial executors (arbiter inside)',
  })

  cases.push({
    caller: 'frozenSurgicalPruneCore.ts/marathon_active_zero_mutation',
    ok: (() => {
      const coreDir = dirname(fileURLToPath(import.meta.url))
      const source = readFileSync(join(coreDir, 'frozenSurgicalPruneCore.ts'), 'utf8')
      return source.includes('marathon_active_zero_data_plane_mutation')
    })(),
    detail: 'R-34 carrier prune blocked while marathon active',
  })

  const inventoryModules = P10_DIAL_CAPABILITY_INVENTORY.length
  const ok = cases.every((item) => item.ok)
  return { ok, inventoryModules, cases }
}
