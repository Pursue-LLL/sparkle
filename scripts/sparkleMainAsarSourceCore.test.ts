import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  collectSparkleMainProcessDiskSource,
  listSparkleMainProcessJsDiskPaths,
} from './sparkleMainAsarSourceCore'
import { validateSparkleMainAsarBundle } from './upgradeSparkleAsarGateCore'

describe('sparkleMainAsarSourceCore disk collector', () => {
  it('aggregates split chunks on disk like packaged asar', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sparkle-main-out-'))
    writeFileSync(
      path.join(dir, 'index.js'),
      'appendAppLog .markCoreReadyAtMs( mihomoCloseConnection',
      'utf8',
    )
    writeFileSync(
      path.join(dir, 'mihomoQuicSilentStallRecovery-abc.js'),
      [
        'close_frozen_connection frozen_surgical_prune marathon_sse_carrier_frozen_prune',
        'Hy2ParentSidecar phase=execute deny_unbound_critical_host attempt_rate_pct below_target_attempt',
        'StallEscalationLadder r41_critical_host_no_close TransportMutationGate mtic_v2_transport_mutation_gate',
        'MarathonHy2Only marathon_hy2_only',
        'emergency_parent_refresh_bypass requireCarrierBytesRecovery observability_probe_admitted carrier_recovered=',
        'resolveHy2ParentUdpOutboundConnectionId byte_death_no_udp_outbound_sidecar_emergency',
        'byte_death_probe_only_without_udp_close byte_death_close_frozen_leaf_batch',
        'byte_death_udp_absent_requires_core_restart byte_death_udp_parent_unknown',
        '[RecoveryCoordinator]: [EmergencyCoreRecovery]: [ByteDeathRecoveryHonesty]:',
        'scheduleByteDeathRecoveryVerification',
        '',
        'requestEmergencyCoreRecovery reset_parent_chain_birth byteDeathFullScan',
        '[Hy2ParentByteDeathRecovery]: executeByteDeathParentMutation mihomoGetConnections',
        'byte_death_mutation_failed_blocking_sidecar byte_death_rotation_ssot',
        '[CoreReadiness]: fallback_ladder cursor_dedicated_dial_failure_cluster_udp_absent',
        'stale_session_overrides_vitality_counterproof coreLogDialFailureTailWatcher asar_gate_test_anchor api2_anchor_rejected',
        'proactive_hard_rotate cursor_dedicated_mihomo probeRecoveryApi2AnchorDetailed',
        'notifyCollectiveDeathAlert cursorApi2MihomoProbe dial_cluster_commercial_leaf_skip_hy2_udp',
        '[ProxyStackDeadlock]: proxy_stack_not_confirmed_deadlock proxy_stack_deadlock_longflow_overrides_mixed_port',
        'measuredLongflowEvidence unknownLongflowEvidence proxy_stack_longflow_evidence_unknown',
        'emergency_core_restart_removed',
      ].join(' '),
      'utf8',
    )

    assert.equal(listSparkleMainProcessJsDiskPaths(dir).length, 2)
    const source = collectSparkleMainProcessDiskSource(dir)
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
  })
})
