import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertSparkleMainAsarBundle,
  validateSparkleMainAsarBundle,
} from './upgradeSparkleAsarGateCore'

const CONTROL_PLANE_MARKERS =
  'emergency_parent_refresh_bypass requireCarrierBytesRecovery observability_probe_admitted carrier_recovered= resolveHy2ParentUdpOutboundConnectionId byte_death_no_udp_outbound_sidecar_emergency byte_death_probe_only_without_udp_close byte_death_close_frozen_leaf_batch byte_death_udp_absent_requires_core_restart byte_death_udp_parent_unknown [RecoveryCoordinator]: [EmergencyCoreRecovery]: [ByteDeathRecoveryHonesty]: scheduleByteDeathRecoveryVerification invokeEmergencyCoreRestart registerEmergencyCoreRestartHandler --sparkle-emergency-recovery-smoke [EmergencyRecoverySmoke]: requestEmergencyCoreRecovery restartCoreEmergency reset_parent_chain_birth byteDeathFullScan mihomoGetConnections [Hy2ParentByteDeathRecovery]: executeByteDeathParentMutation byte_death_mutation_failed_blocking_sidecar byte_death_rotation_ssot'

const RECOVERY_TRUTH_MARKERS =
  'fallback_ladder cursor_dedicated_dial_failure_cluster_udp_absent stale_session_overrides_vitality_counterproof coreLogDialFailureTailWatcher'

const CORE_READINESS_MARKERS = '[CoreReadiness]: runCoreReadinessPipeline'

const BASE_MARKERS =
  'appendAppLog .markCoreReadyAtMs( frozen_surgical_prune mihomoCloseConnection attempt_rate_pct marathon_sse_carrier_frozen_prune Hy2ParentSidecar phase=execute deny_unbound_critical_host StallEscalationLadder r41_critical_host_no_close TransportMutationGate mtic_v2_transport_mutation_gate MarathonHy2Only marathon_hy2_only below_target_attempt'

function validBundle(extra = ''): string {
  return `${BASE_MARKERS} ${CONTROL_PLANE_MARKERS} ${RECOVERY_TRUTH_MARKERS} ${CORE_READINESS_MARKERS} ${extra}`
}

describe('upgradeSparkleAsarGateCore', () => {
  it('accepts linked networkStartupGraceCore.markCoreReadyAtMs call with R-34 close wiring', () => {
    const source = validBundle('close_frozen_connection maxStepsRateObserver')
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
    assert.doesNotThrow(() => assertSparkleMainAsarBundle(source))
  })

  it('rejects bare markCoreReadyAtMs() without chunk prefix (BUG-2026-07-23-004 regression)', () => {
    const broken = `
      require_log.appendAppLog("x");
      markCoreReadyAtMs();
    `
    const result = validateSparkleMainAsarBundle(broken)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'missing_mark_core_ready_call')
  })

  it('rejects stale bundle missing appendAppLog', () => {
    const result = validateSparkleMainAsarBundle(
      'markCoreReadyAtMs(); frozen_surgical_prune mihomoCloseConnection',
    )
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'stale_bundle')
  })

  it('rejects marathon_block_close_connection regression', () => {
    const source =
      'appendAppLog frozen_surgical_prune mihomoCloseConnection .markCoreReadyAtMs( marathon_block_close_connection'
    const result = validateSparkleMainAsarBundle(source)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'regression_marathon_block_close')
  })

  it('accepts minified .markCoreReadyAtMs( pattern from Vite chunk export', () => {
    assert.deepEqual(validateSparkleMainAsarBundle(validBundle()), { ok: true })
  })

  it('accepts R-34 markers in code-split chunk when index.js lacks them', () => {
    const indexChunk =
      'require_log.appendAppLog("x"); require_networkStartupGraceCore.markCoreReadyAtMs(); mihomoCloseConnection'
    const stallChunk = validBundle('close_frozen_connection maxStepsRateObserver')
    const source = `${indexChunk}\n${stallChunk}`
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
  })

  it('accepts C-8.11 SSOT without legacy byte_death_close_connections_by_leaf', () => {
    assert.deepEqual(validateSparkleMainAsarBundle(validBundle()), { ok: true })
  })

  it('rejects invalid JS regex PCRE inline flags', () => {
    const source = `${validBundle()} return /(?i)-VPS-HY2$/.test(x)`
    const result = validateSparkleMainAsarBundle(source)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'invalid_js_regex_pcre')
  })

  it('rejects bundle missing Core Readiness gate', () => {
    const source = `${BASE_MARKERS} ${CONTROL_PLANE_MARKERS} ${RECOVERY_TRUTH_MARKERS}`
    const result = validateSparkleMainAsarBundle(source)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'missing_core_readiness_gate')
  })

  it('rejects bundle missing BUG-009/010 recovery truth markers', () => {
    const source = `${BASE_MARKERS} ${CONTROL_PLANE_MARKERS} ${CORE_READINESS_MARKERS}`
    const result = validateSparkleMainAsarBundle(source)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'missing_bug20260903_recovery_truth')
  })
})
