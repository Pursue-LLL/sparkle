// [INPUT] module source inventory
// [OUTPUT] auditDialCapabilityInventory
// [POS] P10-2 SSOT — static dial-capability provenance audit; production bypass allowed.

export interface DialCapabilityEntry {
  module: string
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
}

/** Non-production dial modules must reference admission arbiter before side effects. */
export const P10_DIAL_CAPABILITY_INVENTORY: readonly DialCapabilityEntry[] = [
  {
    module: 'marathonRescueDialExecutor.ts',
    capability: 'marathon_rescue_session_dial',
    requiredArbiter: true,
    requiredPatterns: ['admissionIntent', 'completeDialIntent'],
  },
  {
    module: 'marathonWarmthDialExecutor.ts',
    capability: 'marathon_warmth_session_dial',
    requiredArbiter: true,
    requiredPatterns: ['admissionIntent'],
  },
  {
    module: 'hy2TunnelVitality.ts',
    capability: 'hy2_tunnel_vitality_connect_path',
    requiredArbiter: true,
    requiredPatterns: ['admitDialIntent', 'completeDialIntent'],
  },
  {
    module: 'marathonTransportDialOrchestrator.ts',
    capability: 'connect_path_pulse',
    requiredArbiter: true,
    requiredPatterns: ['admitDialIntent', 'connectPathPulse'],
  },
  {
    module: 'marathonQuiesce.ts',
    capability: 'quiesce_health_check_yaml',
    requiredArbiter: false,
    requiredPatterns: ['reload=0', 'yaml_persist_only'],
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
  return { ok: violations.length === 0, violations }
}
