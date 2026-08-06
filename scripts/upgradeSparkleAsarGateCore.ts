/** SSOT: post-build asar main bundle checks (upgrade-sparkle-local.sh + unit tests). */

export type SparkleMainAsarGateResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'missing_main'
        | 'stale_bundle'
        | 'missing_mark_core_ready_call'
        | 'missing_r34_frozen_prune'
        | 'regression_marathon_block_close'
        | 'missing_mihomo_close_connection'
        | 'missing_p28b_attempt_rate'
        | 'missing_r35_carrier_prune'
        | 'missing_r35_parent_sidecar'
        | 'missing_bug20260805_control_plane'
    }

/** Vite minifies to `.markCoreReadyAtMs(` on chunk export — bare `markCoreReadyAtMs(` is BUG-2026-07-23-004. */
export function validateSparkleMainAsarBundle(mainSource: string): SparkleMainAsarGateResult {
  if (!mainSource.includes('appendAppLog')) {
    return { ok: false, reason: 'stale_bundle' }
  }
  if (mainSource.includes('.markCoreReadyAtMs(')) {
    // continue — markCoreReady present
  } else if (/\bmarkCoreReadyAtMs\s*\(/.test(mainSource)) {
    return { ok: false, reason: 'missing_mark_core_ready_call' }
  } else {
    return { ok: false, reason: 'missing_mark_core_ready_call' }
  }

  if (mainSource.includes('marathon_block_close_connection')) {
    return { ok: false, reason: 'regression_marathon_block_close' }
  }
  if (
    !mainSource.includes('frozen_surgical_prune') &&
    !mainSource.includes('close_frozen_connection')
  ) {
    return { ok: false, reason: 'missing_r34_frozen_prune' }
  }
  if (
    !mainSource.includes('mihomoCloseConnection') &&
    !mainSource.includes('.mihomoCloseConnection(')
  ) {
    return { ok: false, reason: 'missing_mihomo_close_connection' }
  }
  if (
    !mainSource.includes('attempt_rate_pct') &&
    !mainSource.includes('below_target_attempt')
  ) {
    return { ok: false, reason: 'missing_p28b_attempt_rate' }
  }
  if (!mainSource.includes('marathon_sse_carrier_frozen_prune')) {
    return { ok: false, reason: 'missing_r35_carrier_prune' }
  }
  if (
    !mainSource.includes('Hy2ParentSidecar') ||
    !mainSource.includes('phase=execute') ||
    !mainSource.includes('deny_unbound_critical_host') ||
    !mainSource.includes('StallEscalationLadder') ||
    !mainSource.includes('r41_critical_host_no_close') ||
    !mainSource.includes('TransportMutationGate') ||
    !mainSource.includes('mtic_v2_transport_mutation_gate') ||
    !mainSource.includes('MarathonHy2Only') ||
    !mainSource.includes('marathon_hy2_only')
  ) {
    return { ok: false, reason: 'missing_r35_parent_sidecar' }
  }
  if (
    !mainSource.includes('emergency_parent_refresh_bypass') ||
    !mainSource.includes('requireCarrierBytesRecovery') ||
    !mainSource.includes('observability_probe_admitted') ||
    !mainSource.includes('carrier_recovered=') ||
    !mainSource.includes('resolveHy2ParentUdpOutboundConnectionId') ||
    !mainSource.includes('byte_death_no_udp_outbound_sidecar_emergency') ||
    !mainSource.includes('byte_death_probe_only_without_udp_close') ||
    !mainSource.includes('byte_death_close_connections_by_leaf') ||
    !mainSource.includes('byteDeathFullScan') ||
    mainSource.includes('ghost_udp_parent_birth_reset')
  ) {
    return { ok: false, reason: 'missing_bug20260805_control_plane' }
  }

  return { ok: true }
}

export function assertSparkleMainAsarBundle(mainSource: string): void {
  const result = validateSparkleMainAsarBundle(mainSource)
  if (!result.ok) {
    const messages: Record<Exclude<SparkleMainAsarGateResult, { ok: true }>['reason'], string> = {
      missing_main: 'asar missing out/main/index.js',
      stale_bundle: 'asar main bundle looks stale or corrupt',
      missing_mark_core_ready_call: 'asar missing markCoreReadyAtMs call — PostCoreBootstrap will fail',
      missing_r34_frozen_prune: 'asar missing R-34 frozen_surgical_prune — stall recovery will block close',
      regression_marathon_block_close: 'asar still contains marathon_block_close_connection regression',
      missing_mihomo_close_connection: 'asar missing mihomoCloseConnection — frozen prune close will fail at runtime',
      missing_p28b_attempt_rate: 'asar missing P28b attempt_rate_pct — G9 soak SLO metrics will not emit',
      missing_r35_carrier_prune: 'asar missing R-35 marathon_sse_carrier_frozen_prune',
      missing_r35_parent_sidecar: 'asar missing R-40/R-41 Hy2ParentSidecar execute + deny_unbound + StallEscalationLadder',
      missing_bug20260805_control_plane: 'asar missing BUG-2026-08-05-001 control-plane fixes @1.30.3 (emergency bypass + carrier honesty + observability_probe)',
    }
    throw new Error(messages[result.reason])
  }
}
