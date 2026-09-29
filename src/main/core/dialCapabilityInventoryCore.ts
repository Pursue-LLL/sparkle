// [INPUT] module source inventory
// [OUTPUT] auditDialCapabilityInventory · discoverUnlistedDataPlaneMutationModules
// [POS] P10-2 SSOT — machine-generated dial/close/route/TUN capability provenance audit.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface DialCapabilityEntry {
  module: string
  /** Path under src/main/ */
  sourcePath: string
  capability: string
  requiredArbiter: boolean
  requiredPatterns: readonly string[]
}

export interface DialCapabilityInventoryViolation {
  module: string
  capability: string
  missingPattern: string
}

export interface DialCapabilityInventoryResult {
  ok: boolean
  violations: DialCapabilityInventoryViolation[]
  unlistedModules: string[]
}

/** Canonical low-level mutation exports — not duplicate-listed as callers. */
export const P10_DIAL_MUTATION_CANONICAL_HOLDERS: readonly string[] = [
  'core/mihomoApi.ts',
  'core/provider.ts',
  'core/marathonCoreRestartGuard.ts',
  'core/marathonRescueDialExecutor.ts',
  'core/marathonWarmthDialExecutor.ts',
]

/** Machine-scanned data-plane mutation call patterns (§M.0.15.13 item 3). */
export const P10_DATA_PLANE_MUTATION_PATTERNS: readonly { id: string; pattern: RegExp }[] = [
  { id: 'reloadMihomoConfigFromDisk', pattern: /\breloadMihomoConfigFromDisk\s*\(/ },
  { id: 'reloadMihomoProfileProviders', pattern: /\breloadMihomoProfileProviders\s*\(/ },
  { id: 'mihomoCloseConnection', pattern: /\bmihomoCloseConnection\s*\(/ },
  { id: 'mihomoCloseConnections', pattern: /\bmihomoCloseConnections\s*\(/ },
  { id: 'executeMarathonRescueDial', pattern: /\bexecuteMarathonRescueDial\s*\(/ },
  { id: 'executeMarathonWarmthDial', pattern: /\bexecuteMarathonWarmthDial\s*\(/ },
  { id: 'mihomoChangeProxy', pattern: /\bmihomoChangeProxy\s*\(/ },
  { id: 'changeProxyApi', pattern: /\bchangeProxyApi\s*\(/ },
  { id: 'mihomoFlushFakeIpCache', pattern: /\bmihomoFlushFakeIpCache\s*\(/ },
  { id: 'restartMihomoConnections', pattern: /\brestartMihomoConnections\s*\(/ },
  { id: 'restartMihomoLogs', pattern: /\brestartMihomoLogs\s*\(/ },
  { id: 'startMihomoTraffic', pattern: /\bstartMihomoTraffic\s*\(/ },
  { id: 'evaluateMarathonCoreColdRestart', pattern: /\bevaluateMarathonCoreColdRestart\s*\(/ },
]

export const P10_DIAL_CAPABILITY_INVENTORY: readonly DialCapabilityEntry[] = [
  {
    module: 'marathonRescueDialExecutor.ts',
    sourcePath: 'core/marathonRescueDialExecutor.ts',
    capability: 'marathon_rescue_session_dial',
    requiredArbiter: true,
    requiredPatterns: ['admissionIntent', 'completeDialIntent'],
  },
  {
    module: 'marathonWarmthDialExecutor.ts',
    sourcePath: 'core/marathonWarmthDialExecutor.ts',
    capability: 'marathon_warmth_session_dial',
    requiredArbiter: true,
    requiredPatterns: ['admissionIntent', 'completeDialIntent'],
  },
  {
    module: 'hy2TunnelVitality.ts',
    sourcePath: 'core/hy2TunnelVitality.ts',
    capability: 'hy2_tunnel_vitality_connect_path',
    requiredArbiter: true,
    requiredPatterns: ['admitDialIntent', 'completeDialIntent'],
  },
  {
    module: 'marathonTransportDialOrchestrator.ts',
    sourcePath: 'core/marathonTransportDialOrchestrator.ts',
    capability: 'connect_path_pulse',
    requiredArbiter: true,
    requiredPatterns: ['admitDialIntent', 'connectPathPulse'],
  },
  {
    module: 'cursorHy2MarathonKeepalive.ts',
    sourcePath: 'core/cursorHy2MarathonKeepalive.ts',
    capability: 'hy2_session_keepalive_rescue_warmth',
    requiredArbiter: true,
    requiredPatterns: ['executeMarathonRescueDial', 'executeMarathonWarmthDial'],
  },
  {
    module: 'mihomoQuicSilentStallRecovery.ts',
    sourcePath: 'core/mihomoQuicSilentStallRecovery.ts',
    capability: 'quic_stall_frozen_prune_close',
    requiredArbiter: false,
    requiredPatterns: ['resolveFrozenSurgicalPrunePlan', 'marathonActive'],
  },
  {
    module: 'cursorConnectionHygiene.ts',
    sourcePath: 'core/cursorConnectionHygiene.ts',
    capability: 'cursor_connection_hygiene_close',
    requiredArbiter: false,
    requiredPatterns: ['mihomoCloseConnection'],
  },
  {
    module: 'cursorTransportHealth.ts',
    sourcePath: 'core/cursorTransportHealth.ts',
    capability: 'transport_recovery_l2_flush_close',
    requiredArbiter: false,
    requiredPatterns: ['decideTransportRecoveryExecution', 'mihomoCloseConnections'],
  },
  {
    module: 'cursorDedicatedDefault.ts',
    sourcePath: 'core/cursorDedicatedDefault.ts',
    capability: 'cursor_dedicated_default_change_proxy',
    requiredArbiter: false,
    requiredPatterns: ['changeProxyApi', 'CURSOR_DEDICATED_GROUP_NAME'],
  },
  {
    module: 'marathonProtocolContract.ts',
    sourcePath: 'core/marathonProtocolContract.ts',
    capability: 'marathon_protocol_cold_start_change_proxy',
    requiredArbiter: false,
    requiredPatterns: ['mihomoChangeProxy', 'marathonTruthActive'],
  },
  {
    module: 'marathonQuiesce.ts',
    sourcePath: 'core/marathonQuiesce.ts',
    capability: 'quiesce_health_check_yaml',
    requiredArbiter: false,
    requiredPatterns: ['reload=0', 'yaml_persist_only'],
  },
  {
    module: 'marathonDialTolerance.ts',
    sourcePath: 'core/marathonDialTolerance.ts',
    capability: 'marathon_dial_tolerance_idle_bootstrap',
    requiredArbiter: false,
    requiredPatterns: ['shouldAllowMarathonDialToleranceBootstrapAtIdle', 'data_plane_action=none'],
  },
  {
    module: 'manager.ts',
    sourcePath: 'core/manager.ts',
    capability: 'core_cold_restart',
    requiredArbiter: false,
    requiredPatterns: ['evaluateMarathonCoreColdRestart'],
  },
  {
    module: 'mihomoApiSocketWatchdog.ts',
    sourcePath: 'core/mihomoApiSocketWatchdog.ts',
    capability: 'socket_watchdog_core_restart',
    requiredArbiter: false,
    requiredPatterns: ['evaluateMarathonCoreColdRestart'],
  },
  {
    module: 'ipc.ts',
    sourcePath: 'utils/ipc.ts',
    capability: 'app_config_mihomo_reload',
    requiredArbiter: false,
    requiredPatterns: ['shouldDeferAppConfigMihomoReload'],
  },
  {
    module: 'profile.ts',
    sourcePath: 'config/profile.ts',
    capability: 'profile_save_provider_reload',
    requiredArbiter: false,
    requiredPatterns: ['shouldDeferProfileProviderReload', 'reloadMihomoProfileProviders'],
  },
  {
    module: 'tray.ts',
    sourcePath: 'resolve/tray.ts',
    capability: 'tray_close_connections_change_proxy',
    requiredArbiter: false,
    requiredPatterns: ['mihomoCloseConnections', 'mihomoChangeProxy'],
  },
  {
    module: 'coreLifecycle.ts',
    sourcePath: 'core/coreLifecycle.ts',
    capability: 'core_lifecycle_fakeip_flush',
    requiredArbiter: false,
    requiredPatterns: ['mihomoFlushFakeIpCache'],
  },
  {
    module: 'cursorDedicatedDialFailureClusterRuntime.ts',
    sourcePath: 'core/cursorDedicatedDialFailureClusterRuntime.ts',
    capability: 'dial_cluster_rescue_close',
    requiredArbiter: false,
    requiredPatterns: ['mihomoCloseConnection'],
  },
  {
    module: 'hy2ParentSidecar.ts',
    sourcePath: 'core/hy2ParentSidecar.ts',
    capability: 'hy2_sidecar_rescue_close',
    requiredArbiter: false,
    requiredPatterns: ['mihomoCloseConnection'],
  },
  {
    module: 'profileCacheRefreshCore.ts',
    sourcePath: 'core/profileCacheRefreshCore.ts',
    capability: 'profile_cache_provider_reload',
    requiredArbiter: false,
    requiredPatterns: ['reloadMihomoProfileProviders'],
  },
  {
    module: 'profileUpdateDueCli.ts',
    sourcePath: 'core/profileUpdateDueCli.ts',
    capability: 'profile_update_due_hot_reload',
    requiredArbiter: false,
    requiredPatterns: ['runDueProfileUpdates'],
  },
  {
    module: 'recoveryCoordinator.ts',
    sourcePath: 'core/recoveryCoordinator.ts',
    capability: 'recovery_coordinator_change_proxy',
    requiredArbiter: false,
    requiredPatterns: ['mihomoChangeProxy'],
  },
  {
    module: 'recoveryCursorDedicatedFailback.ts',
    sourcePath: 'core/recoveryCursorDedicatedFailback.ts',
    capability: 'recovery_failback_change_proxy',
    requiredArbiter: false,
    requiredPatterns: ['mihomoChangeProxy'],
  },
]

export function auditDialCapabilityInventory(
  sourcesByModule: Readonly<Record<string, string>>,
): DialCapabilityInventoryResult {
  const violations: DialCapabilityInventoryViolation[] = []
  for (const entry of P10_DIAL_CAPABILITY_INVENTORY) {
    const source = sourcesByModule[entry.module]
    if (!source) {
      violations.push({
        module: entry.module,
        capability: entry.capability,
        missingPattern: '<module missing>',
      })
      continue
    }
    for (const pattern of entry.requiredPatterns) {
      if (!source.includes(pattern)) {
        violations.push({
          module: entry.module,
          capability: entry.capability,
          missingPattern: pattern,
        })
      }
    }
    if (entry.requiredArbiter && source.includes('reloadMihomoConfigFromDisk')) {
      violations.push({
        module: entry.module,
        capability: entry.capability,
        missingPattern: 'no-reloadMihomoConfigFromDisk',
      })
    }
  }
  return { ok: violations.length === 0, violations, unlistedModules: [] }
}

function listTypeScriptFiles(dir: string, prefix: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    if (statSync(full).isDirectory()) {
      out.push(...listTypeScriptFiles(full, rel))
      continue
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(rel)
    }
  }
  return out
}

export function sourceHasDataPlaneMutationCall(source: string): boolean {
  return P10_DATA_PLANE_MUTATION_PATTERNS.some(({ pattern }) => pattern.test(source))
}

export function listDataPlaneMutationHits(source: string): string[] {
  return P10_DATA_PLANE_MUTATION_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
    ({ id }) => id,
  )
}

/** @deprecated use discoverUnlistedDataPlaneMutationModules */
export function discoverUnlistedDialMutationModules(srcMainRoot: string): string[] {
  return discoverUnlistedDataPlaneMutationModules(srcMainRoot)
}

export function discoverUnlistedDataPlaneMutationModules(srcMainRoot: string): string[] {
  const listedPaths = new Set(P10_DIAL_CAPABILITY_INVENTORY.map((entry) => entry.sourcePath))
  const unlisted: string[] = []
  for (const relPath of listTypeScriptFiles(srcMainRoot, '')) {
    if (P10_DIAL_MUTATION_CANONICAL_HOLDERS.includes(relPath)) {
      continue
    }
    const source = readFileSync(join(srcMainRoot, relPath), 'utf8')
    if (!sourceHasDataPlaneMutationCall(source)) {
      continue
    }
    if (!listedPaths.has(relPath)) {
      unlisted.push(relPath)
    }
  }
  return unlisted.sort()
}

export function runDialCapabilityInventoryAudit(srcMainRoot: string): DialCapabilityInventoryResult {
  const sourcesByModule: Record<string, string> = {}
  for (const entry of P10_DIAL_CAPABILITY_INVENTORY) {
    sourcesByModule[entry.module] = readFileSync(join(srcMainRoot, entry.sourcePath), 'utf8')
  }
  const base = auditDialCapabilityInventory(sourcesByModule)
  const unlistedModules = discoverUnlistedDataPlaneMutationModules(srcMainRoot)
  return {
    ok: base.ok && unlistedModules.length === 0,
    violations: base.violations,
    unlistedModules,
  }
}
