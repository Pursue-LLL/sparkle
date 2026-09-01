import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertSparkleMainAsarBundle,
  validateSparkleMainAsarBundle,
} from './upgradeSparkleAsarGateCore'

describe('upgradeSparkleAsarGateCore', () => {
  it('accepts linked networkStartupGraceCore.markCoreReadyAtMs call with R-34 close wiring', () => {
    const source = `
      require_log.appendAppLog("x");
      require_networkStartupGraceCore.markCoreReadyAtMs();
      frozen_surgical_prune close_frozen_connection mihomoCloseConnection maxStepsRateObserver attempt_rate_pct below_target_attempt marathon_sse_carrier_frozen_prune Hy2ParentSidecar phase=execute deny_unbound_critical_host StallEscalationLadder r41_critical_host_no_close TransportMutationGate mtic_v2_transport_mutation_gate MarathonHy2Only marathon_hy2_only emergency_parent_refresh_bypass requireCarrierBytesRecovery observability_probe_admitted carrier_recovered= resolveHy2ParentUdpOutboundConnectionId byte_death_no_udp_outbound_sidecar_emergency byte_death_probe_only_without_udp_close byte_death_close_connections_by_leaf byte_death_close_frozen_leaf_batch byte_death_udp_absent_requires_core_restart byte_death_udp_parent_unknown [RecoveryCoordinator]: [EmergencyCoreRecovery]: requestEmergencyCoreRecovery restartCoreEmergency reset_parent_chain_birth byteDeathFullScan mihomoGetConnections [Hy2ParentByteDeathRecovery]: executeByteDeathParentMutation byte_death_mutation_failed_blocking_sidecar byte_death_rotation_ssot [CoreReadiness]: runCoreReadinessPipeline [CoreReadiness]: runCoreReadinessPipeline
    `
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
    const source =
      'foo.markCoreReadyAtMs(); require_log.appendAppLog("x"); frozen_surgical_prune mihomoCloseConnection attempt_rate_pct marathon_sse_carrier_frozen_prune Hy2ParentSidecar phase=execute deny_unbound_critical_host StallEscalationLadder r41_critical_host_no_close TransportMutationGate mtic_v2_transport_mutation_gate MarathonHy2Only marathon_hy2_only below_target_attempt emergency_parent_refresh_bypass requireCarrierBytesRecovery observability_probe_admitted carrier_recovered= resolveHy2ParentUdpOutboundConnectionId byte_death_no_udp_outbound_sidecar_emergency byte_death_probe_only_without_udp_close byte_death_close_connections_by_leaf byte_death_close_frozen_leaf_batch byte_death_udp_absent_requires_core_restart byte_death_udp_parent_unknown [RecoveryCoordinator]: [EmergencyCoreRecovery]: requestEmergencyCoreRecovery restartCoreEmergency reset_parent_chain_birth byteDeathFullScan mihomoGetConnections [Hy2ParentByteDeathRecovery]: executeByteDeathParentMutation byte_death_mutation_failed_blocking_sidecar byte_death_rotation_ssot [CoreReadiness]: runCoreReadinessPipeline'
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
  })

  it('accepts R-34 markers in code-split chunk when index.js lacks them', () => {
    const indexChunk =
      'require_log.appendAppLog("x"); require_networkStartupGraceCore.markCoreReadyAtMs(); mihomoCloseConnection'
    const stallChunk = 'close_frozen_connection frozen_surgical_prune maxStepsRateObserver attempt_rate_pct below_target_attempt marathon_sse_carrier_frozen_prune Hy2ParentSidecar phase=execute deny_unbound_critical_host StallEscalationLadder r41_critical_host_no_close TransportMutationGate mtic_v2_transport_mutation_gate MarathonHy2Only marathon_hy2_only emergency_parent_refresh_bypass requireCarrierBytesRecovery observability_probe_admitted carrier_recovered= resolveHy2ParentUdpOutboundConnectionId byte_death_no_udp_outbound_sidecar_emergency byte_death_probe_only_without_udp_close byte_death_close_connections_by_leaf byte_death_close_frozen_leaf_batch byte_death_udp_absent_requires_core_restart byte_death_udp_parent_unknown [RecoveryCoordinator]: [EmergencyCoreRecovery]: requestEmergencyCoreRecovery restartCoreEmergency reset_parent_chain_birth byteDeathFullScan mihomoGetConnections [Hy2ParentByteDeathRecovery]: executeByteDeathParentMutation byte_death_mutation_failed_blocking_sidecar byte_death_rotation_ssot [CoreReadiness]: runCoreReadinessPipeline'
    const source = `${indexChunk}\n${stallChunk}`
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
  })

  it('accepts C-8.11 SSOT without legacy byte_death_close_connections_by_leaf', () => {
    const source =
      'foo.markCoreReadyAtMs(); require_log.appendAppLog("x"); frozen_surgical_prune mihomoCloseConnection attempt_rate_pct marathon_sse_carrier_frozen_prune Hy2ParentSidecar phase=execute deny_unbound_critical_host StallEscalationLadder r41_critical_host_no_close TransportMutationGate mtic_v2_transport_mutation_gate MarathonHy2Only marathon_hy2_only below_target_attempt emergency_parent_refresh_bypass requireCarrierBytesRecovery observability_probe_admitted carrier_recovered= resolveHy2ParentUdpOutboundConnectionId byte_death_no_udp_outbound_sidecar_emergency byte_death_probe_only_without_udp_close byte_death_close_frozen_leaf_batch byte_death_udp_absent_requires_core_restart byte_death_udp_parent_unknown [RecoveryCoordinator]: [EmergencyCoreRecovery]: requestEmergencyCoreRecovery restartCoreEmergency reset_parent_chain_birth byteDeathFullScan mihomoGetConnections [Hy2ParentByteDeathRecovery]: executeByteDeathParentMutation byte_death_mutation_failed_blocking_sidecar byte_death_rotation_ssot [CoreReadiness]: runCoreReadinessPipeline'
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
  })

  it('rejects invalid JS regex PCRE inline flags', () => {
    const source =
      'appendAppLog .markCoreReadyAtMs( frozen_surgical_prune mihomoCloseConnection attempt_rate_pct marathon_sse_carrier_frozen_prune Hy2ParentSidecar phase=execute deny_unbound_critical_host StallEscalationLadder r41_critical_host_no_close TransportMutationGate mtic_v2_transport_mutation_gate MarathonHy2Only marathon_hy2_only emergency_parent_refresh_bypass requireCarrierBytesRecovery observability_probe_admitted carrier_recovered= resolveHy2ParentUdpOutboundConnectionId byte_death_no_udp_outbound_sidecar_emergency byte_death_probe_only_without_udp_close byte_death_close_frozen_leaf_batch byte_death_udp_absent_requires_core_restart byte_death_udp_parent_unknown [RecoveryCoordinator]: [EmergencyCoreRecovery]: requestEmergencyCoreRecovery restartCoreEmergency reset_parent_chain_birth byteDeathFullScan mihomoGetConnections [Hy2ParentByteDeathRecovery]: executeByteDeathParentMutation byte_death_mutation_failed_blocking_sidecar byte_death_rotation_ssot [CoreReadiness]: runCoreReadinessPipeline return /(?i)-VPS-HY2$/.test(x)'
    const result = validateSparkleMainAsarBundle(source)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'invalid_js_regex_pcre')
  })

  it('rejects bundle missing Core Readiness gate', () => {
    const source =
      'appendAppLog .markCoreReadyAtMs( frozen_surgical_prune mihomoCloseConnection attempt_rate_pct marathon_sse_carrier_frozen_prune Hy2ParentSidecar phase=execute deny_unbound_critical_host StallEscalationLadder r41_critical_host_no_close TransportMutationGate mtic_v2_transport_mutation_gate MarathonHy2Only marathon_hy2_only emergency_parent_refresh_bypass requireCarrierBytesRecovery observability_probe_admitted carrier_recovered= resolveHy2ParentUdpOutboundConnectionId byte_death_no_udp_outbound_sidecar_emergency byte_death_probe_only_without_udp_close byte_death_close_frozen_leaf_batch byte_death_udp_absent_requires_core_restart byte_death_udp_parent_unknown [RecoveryCoordinator]: [EmergencyCoreRecovery]: requestEmergencyCoreRecovery restartCoreEmergency reset_parent_chain_birth byteDeathFullScan mihomoGetConnections [Hy2ParentByteDeathRecovery]: executeByteDeathParentMutation byte_death_mutation_failed_blocking_sidecar byte_death_rotation_ssot'
    const result = validateSparkleMainAsarBundle(source)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'missing_core_readiness_gate')
  })
})
