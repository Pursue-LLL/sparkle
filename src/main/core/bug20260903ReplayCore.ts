// [INPUT] Sep 2 stall + Aug 31 provider parity incident fixtures
// [OUTPUT] runBug20260903ReplayGate
// [POS] BUG-2026-09-03-001 regression gate — marathon tier0 SEL + disk provider parity.

import { CARRIER_QUIESCE_BYTE_FROZEN_MS } from './carrierQuiesceRefreshCore'
import { resolveFrozenSurgicalPrunePlan } from './frozenSurgicalPruneCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import {
  resolveExpectedProxyProviderIds,
  shouldRestartServiceCoreForProviderParity,
} from './serviceCoreProviderParityCore'
import {
  recordVitalityByteSnapshot,
  resetStallEscalationLadderStateForTests,
  resolveStallEscalationLadderPlan,
} from './stallEscalationLadderCore'
import {
  resolveUdpParentStateForRecovery,
  shouldFailbackCursorDedicatedToHy2,
} from './recoveryFailoverGovernanceCore'
import { planByteDeathParentMutation } from './hy2ParentByteDeathRecoveryCore'
import {
  CURSOR_DIAL_FAILURE_CLUSTER_MIN_COUNT,
  DIAL_FAILURE_CLUSTER_UDP_ABSENT_REQUIRES_CORE_RESTART,
  shouldForceParentUdpRefreshOnDialCluster,
} from './cursorDedicatedDialFailureClusterCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import { evaluateEmergencyCoreRecoveryAdmission } from './emergencyCoreRecoveryCore'

export interface Bug20260903ReplayVerdict {
  fixtureId: string
  ok: boolean
  detail: string
}

export interface Bug20260903ReplayResult {
  ok: boolean
  verdicts: Bug20260903ReplayVerdict[]
}

/** Sep 2 06:20: 84s frozen_quic + token_gap=0 must route to tier0 SEL, not zero_data_plane dead-end. */
export function replayBug20260903Sep2FrozenQuicTier0Sel(): Bug20260903ReplayVerdict {
  const nowMs = 2_000_000
  const plan = resolveFrozenSurgicalPrunePlan({
    observation: {
      kind: 'single',
      connectionId: 'sep2-conn-frozen',
      host: 'api2direct.cursor.sh',
      leaf: 'JP-VPS-HY2',
      network: 'tcp',
      stallMs: 84_003,
      connAgeMs: 200_000,
      frozenQuicCursorCount: 1,
      totalQuicCursorCount: 49,
      cursorConnectionCount: 49,
    },
    tokenGapMaxMs: 0,
    staleRequestIdCount: 0,
    staleRequestIds: [],
    lastGlobalPruneAtMs: 0,
    lastRecoveryAtMsByConnectionId: new Map(),
    nowMs,
    marathonActive: true,
    httpParentChainAgeMs: 81_656_460,
    outboundHy2SessionAgeMs: 81_656_460,
    registry: { records: new Map() },
  })
  const ok =
    plan.action === 'vitality_dial' &&
    plan.reason === 'marathon_tier0_frozen_quic_cluster_sel' &&
    plan.staleProofKind === 'frozen_quic_cluster'
  return {
    fixtureId: '0903_sep2_frozen_quic_tier0_sel',
    ok,
    detail: ok
      ? '84s frozen_quic routes to tier0 vitality+SEL (not marathon_active_zero_data_plane_mutation)'
      : `plan=${plan.action}/${plan.reason}`,
  }
}

/** Sep 2 follow-on: SEL emergency sidecar at 84s when parent proof without prior vitality ineffective. */
export function replayBug20260903Sep2SelEmergencySidecarBypass(): Bug20260903ReplayVerdict {
  resetStallEscalationLadderStateForTests()
  const nowMs = 2_000_000
  const observation = {
    kind: 'single' as const,
    connectionId: 'sep2-conn-frozen',
    host: 'api2direct.cursor.sh',
    leaf: 'JP-VPS-HY2',
    network: 'tcp',
    stallMs: 84_003,
    connAgeMs: 200_000,
    frozenQuicCursorCount: 1,
    totalQuicCursorCount: 49,
    cursorConnectionCount: 49,
  }
  recordVitalityByteSnapshot({
    connectionId: 'sep2-conn-frozen',
    upload: 1000,
    download: 2000,
    nowMs: nowMs - 5_000,
  })
  const plan = resolveStallEscalationLadderPlan({
    observation,
    upload: 1000,
    download: 2000,
    nowMs,
    requestBoundStallProof: true,
    parentRecoveryProof: true,
    httpParentChainAgeMs: 81_656_460,
    outboundHy2SessionAgeMs: 81_656_460,
  })
  const ok = plan.action === 'emergency_sidecar_dial' && plan.reason === 'emergency_stall_escalation_r1'
  return {
    fixtureId: '0903_sep2_sel_emergency_sidecar_bypass',
    ok,
    detail: ok
      ? 'SEL R1 emergency sidecar at 84s with parent recovery proof'
      : `plan=${plan.action}/${plan.reason}`,
  }
}

/** Aug 31 09:06: empty in-memory runtime must read disk providers before parity defer. */
export async function replayBug20260903Aug31DiskProviderParity(): Promise<Bug20260903ReplayVerdict> {
  const diskConfig = {
    'proxy-providers': {
      '77caf1sub001': { type: 'file', path: 'profiles/x.yaml' },
      '77caf1sub001-vps': { type: 'file', path: 'profiles/y.yaml' },
    },
  }
  const expectedIds = await resolveExpectedProxyProviderIds({
    runtimeConfig: { 'proxy-providers': {} },
    loadDiskRuntimeConfig: async () => diskConfig,
  })
  const runningProviders = {
    '77caf1sub001': { vehicleType: 'File' },
  }
  const needsRestart = shouldRestartServiceCoreForProviderParity(expectedIds, runningProviders)
  const ok =
    expectedIds.length === 2 &&
    expectedIds.includes('77caf1sub001') &&
    expectedIds.includes('77caf1sub001-vps') &&
    needsRestart === true
  return {
    fixtureId: '0903_aug31_disk_provider_parity',
    ok,
    detail: ok
      ? `disk fallback expected=[${expectedIds.join(',')}] restart=${needsRestart}`
      : `expected=${expectedIds.join(',')} restart=${needsRestart}`,
  }
}

/** Guard: parent_stale proof at 45s+ must not hit marathon_active_zero_data_plane_mutation. */
export function replayBug20260903ParentStaleTier0Vitality(): Bug20260903ReplayVerdict {
  const nowMs = 2_000_000
  const plan = resolveFrozenSurgicalPrunePlan({
    observation: {
      kind: 'single',
      connectionId: 'parent-stale-conn',
      host: 'api2.cursor.sh',
      leaf: 'JP-VPS-HY2',
      network: 'tcp',
      stallMs: CARRIER_QUIESCE_BYTE_FROZEN_MS + 2_000,
      connAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 10_000,
      frozenQuicCursorCount: 0,
      totalQuicCursorCount: 20,
      cursorConnectionCount: 25,
    },
    tokenGapMaxMs: 0,
    staleRequestIdCount: 0,
    staleRequestIds: [],
    lastGlobalPruneAtMs: 0,
    lastRecoveryAtMsByConnectionId: new Map(),
    nowMs,
    marathonActive: true,
    httpParentChainAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 10_000,
    registry: { records: new Map() },
  })
  const ok =
    plan.reason !== 'marathon_active_zero_data_plane_mutation' &&
    plan.action === 'vitality_dial' &&
    plan.staleProofKind === 'parent_stale_byte_frozen'
  return {
    fixtureId: '0903_parent_stale_tier0_vitality',
    ok,
    detail: ok ? `parent_stale routes to ${plan.reason}` : `blocked at ${plan.reason}`,
  }
}

/** Sep 3 13:25: vitality 277ms + udp snapshot zero must NOT plan core restart escalation. */
export function replayBug20260903FalseUdpAbsentWithVitality(): Bug20260903ReplayVerdict {
  const nowMs = 2_000_000
  const resolution = {
    source: 'none' as const,
    diagnostics: { totalConnections: 43, udpOnLeafStrict: 0, udpFullScanCandidates: 0 },
  }
  const udpState = resolveUdpParentStateForRecovery({
    resolution,
    lastVitalitySuccessAtMs: nowMs - 45_000,
    nowMs,
  })
  const plan = planByteDeathParentMutation({
    connections: [],
    activeLeaf: 'JP-VPS-HY2',
    trackedFirstSeenAtMsById: new Map(),
    trackedLastByteChangeAtMsById: new Map(),
    nowMs,
    lastVitalitySuccessAtMs: nowMs - 45_000,
  })
  const failback = shouldFailbackCursorDedicatedToHy2({
    currentLeaf: 'JP-VPS-Reality',
    lastVitalitySuccessAtMs: nowMs - 3_000,
    nowMs,
  })
  const ok =
    udpState === 'unknown' &&
    plan.reason === 'byte_death_udp_evidence_insufficient' &&
    failback.failback === true
  return {
    fixtureId: '0903_false_udp_absent_vitality_counterproof',
    ok,
    detail: ok
      ? 'vitality counterproof blocks absent escalation and enables HY2 failback'
      : `udpState=${udpState} plan=${plan.reason} failback=${failback.failback}`,
  }
}

/** Sep 3 16:20: dial cluster + no UDP parent must force fallback ladder (not skip). */
export function replayBug20260903DialClusterNoUdpFallback(): Bug20260903ReplayVerdict {
  const forcePlan = shouldForceParentUdpRefreshOnDialCluster({
    clusterSize: CURSOR_DIAL_FAILURE_CLUSTER_MIN_COUNT,
    activeLeaf: 'JP-VPS-HY2',
  })
  const admission = evaluateEmergencyCoreRecoveryAdmission({
    request: {
      reason: 'confirmed_udp_parent_absent',
      leafId: 'JP-VPS-HY2',
      evidenceReason: DIAL_FAILURE_CLUSTER_UDP_ABSENT_REQUIRES_CORE_RESTART,
      cursorConnectionCount: 12,
      requestedAtMs: 2_000_000,
      deadlineMs: 2_045_000,
    },
    nowMs: 2_000_000,
  })
  const ok =
    forcePlan.force === true &&
    forcePlan.reason === 'dial_failure_cluster_force_udp_refresh' &&
    admission.admitted === true
  return {
    fixtureId: '0903_dial_cluster_no_udp_fallback_ladder',
    ok,
    detail: ok
      ? 'cluster forces UDP refresh + emergency evidence admitted'
      : `force=${forcePlan.force}/${forcePlan.reason} admitted=${admission.admitted}`,
  }
}

/** Sep 3 16:32: stale HY2 session + recent vitality must escalate core restart (not insufficient). */
export function replayBug20260903StaleSessionOverridesVitality(): Bug20260903ReplayVerdict {
  const nowMs = 2_000_000
  const staleAgeMs = HY2_PARENT_SIDECAR_DIAL_AGE_MS + 175_000_000
  const plan = planByteDeathParentMutation({
    connections: Array.from({ length: 39 }, (_, index) => ({
      id: `tcp-${index}`,
      chains: ['Cursor专用', 'JP-VPS-HY2'],
      metadata: { network: 'tcp', host: 'api2.cursor.sh' },
    })) as ControllerConnectionDetail[],
    activeLeaf: 'JP-VPS-HY2',
    trackedFirstSeenAtMsById: new Map(),
    trackedLastByteChangeAtMsById: new Map(),
    nowMs,
    lastVitalitySuccessAtMs: nowMs - 5_000,
    outboundHy2SessionAgeMs: staleAgeMs,
    httpParentChainAgeMs: staleAgeMs,
  })
  const ok =
    plan.action === 'none' &&
    plan.reason === 'byte_death_udp_absent_requires_core_restart'
  return {
    fixtureId: '0903_stale_session_overrides_vitality_counterproof',
    ok,
    detail: ok
      ? 'stale session age overrides vitality counterproof → core restart'
      : `plan=${plan.action}/${plan.reason}`,
  }
}

export async function runBug20260903ReplayGate(): Promise<Bug20260903ReplayResult> {
  const verdicts: Bug20260903ReplayVerdict[] = [
    replayBug20260903Sep2FrozenQuicTier0Sel(),
    replayBug20260903Sep2SelEmergencySidecarBypass(),
    await replayBug20260903Aug31DiskProviderParity(),
    replayBug20260903ParentStaleTier0Vitality(),
    replayBug20260903FalseUdpAbsentWithVitality(),
    replayBug20260903DialClusterNoUdpFallback(),
    replayBug20260903StaleSessionOverridesVitality(),
  ]
  return {
    ok: verdicts.every((verdict) => verdict.ok),
    verdicts,
  }
}
