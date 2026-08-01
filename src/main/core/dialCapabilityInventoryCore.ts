// [INPUT] module source inventory
// [OUTPUT] auditDialCapabilityInventory · discoverUnlistedDialMutationModules
// [POS] P10-2 SSOT — static dial-capability provenance audit; production bypass allowed.

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
]

/** Files that mutate mihomo/data-plane must appear in inventory or explicit guard. */
export const P10_DIAL_MUTATION_MARKERS: readonly string[] = [
  'reloadMihomoConfigFromDisk',
  'reloadMihomoProfileProviders',
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

function sourceHasDialMutationCall(source: string): boolean {
  return (
    /\breloadMihomoConfigFromDisk\s*\(/.test(source) ||
    /\breloadMihomoProfileProviders\s*\(/.test(source)
  )
}

export function discoverUnlistedDialMutationModules(srcMainRoot: string): string[] {
  const listedPaths = new Set(P10_DIAL_CAPABILITY_INVENTORY.map((entry) => entry.sourcePath))
  const unlisted: string[] = []
  for (const relPath of listTypeScriptFiles(srcMainRoot, '')) {
    if (P10_DIAL_MUTATION_CANONICAL_HOLDERS.includes(relPath)) {
      continue
    }
    const source = readFileSync(join(srcMainRoot, relPath), 'utf8')
    if (!sourceHasDialMutationCall(source)) {
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
  const unlistedModules = discoverUnlistedDialMutationModules(srcMainRoot)
  return {
    ok: base.ok && unlistedModules.length === 0,
    violations: base.violations,
    unlistedModules,
  }
}
