// [INPUT] BUG-2026-08-06-001 incident fixtures · pure control-plane cores
// [OUTPUT] runBug20260806ControlPlaneReplayGate
// [POS] C-8 regression gate — replay 8/6 mass disconnect control-plane failure signatures.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createInitialDialAdmissionState,
  resolveDialAdmission,
} from './dialAdmissionArbiterCore'
import { resolveFrozenSurgicalPrunePlan } from './frozenSurgicalPruneCore'
import { resolveHy2ParentUdpOutboundConnectionId } from './hy2ParentCarrierIdentityCore'
import {
  filterHy2LeafConnections,
  planByteDeathParentMutation,
  selectByteDeathLeafCloseTargets,
} from './hy2ParentByteDeathRecoveryCore'
import { resolveMarathonRescueDialAdmissionClass } from './marathonRescueDialExecutor'
import { resolveHy2ParentRotationAfterPrunePlan } from './hy2ParentRotationCore'
import { MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS } from './marathonSseCarrierPruneCore'

export interface Bug20260806ReplayVerdict {
  fixtureId: string
  ok: boolean
  detail: string
}

export interface Bug20260806ControlPlaneReplayResult {
  ok: boolean
  verdicts: Bug20260806ReplayVerdict[]
}

/** 8/6 A1: cursor_conn=158+ — strict UDP lookup missed parent; chain-hop must resolve. */
export function replayBug20260806HighConnUdpChainHop(): Bug20260806ReplayVerdict {
  const nowMs = 2_000_000
  const udp = {
    id: 'udp-high-conn',
    chains: ['JP-VPS-HY2'],
    metadata: { network: 'udp' },
  } as ControllerConnectionDetail
  const resolution = resolveHy2ParentUdpOutboundConnectionId({
    connections: [udp],
    activeLeaf: 'JP-VPS-HY2',
    trackedFirstSeenAtMsById: new Map(),
    nowMs,
  })
  const ok = resolution.connectionId === 'udp-high-conn' && resolution.source === 'mihomo_udp_network'
  return {
    fixtureId: '0806_high_conn_udp_chain_hop',
    ok,
    detail: ok
      ? 'untracked UDP parent resolved at high conn (strict firstSeen fallback)'
      : `resolution source=${resolution.source} id=${resolution.connectionId ?? 'none'}`,
  }
}

/** 8/6: connect_partition rescue must use emergency_parent_refresh (bypass global_control_inflight). */
export function replayBug20260806ConnectPartitionEmergencyAdmission(): Bug20260806ReplayVerdict {
  const admissionClass = resolveMarathonRescueDialAdmissionClass('connect_partition')
  let state = createInitialDialAdmissionState()
  const blocked = resolveDialAdmission(state, {
    dialId: 'recovery-a',
    class: 'active_recovery',
    caller: 'mtdo.token_gap',
    incidentGeneration: 'token_gap:rid-a:100',
    submittedAtMs: 1,
  })
  state = blocked.nextState
  const emergency = resolveDialAdmission(state, {
    dialId: 'connect-partition-rescue',
    class: admissionClass,
    caller: 'marathonRescueDialExecutor',
    incidentGeneration: 'connect_partition:rid-b:200',
    submittedAtMs: 2,
  })
  const ok =
    admissionClass === 'emergency_parent_refresh' &&
    blocked.admitted === true &&
    emergency.admitted === true
  return {
    fixtureId: '0806_connect_partition_emergency_admission',
    ok,
    detail: ok
      ? 'connect_partition admitted as emergency_parent_refresh while active_recovery in-flight'
      : `class=${admissionClass} emergency admitted=${emergency.admitted} reason=${emergency.reason}`,
  }
}

/** 8/6: byte-death + stale RIDs must reach carrier gate (not marathon_active_zero_data_plane_mutation). */
export function replayBug20260806FrozenPruneByteDeathBypass(): Bug20260806ReplayVerdict {
  const nowMs = 2_000_000
  const plan = resolveFrozenSurgicalPrunePlan({
    observation: {
      kind: 'single',
      connectionId: 'conn-frozen',
      host: 'api2.cursor.sh',
      stallMs: MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS + 60_000,
      cursorConnectionCount: 158,
      frozenQuicCursorCount: 5,
      leaf: 'JP-VPS-HY2',
    },
    tokenGapMaxMs: 300_000,
    staleRequestIdCount: 3,
    staleRequestIds: ['0708f0d4-33b6-46cf-97a6-be70bbb311b3'],
    lastGlobalPruneAtMs: nowMs - 30_000,
    lastRecoveryAtMsByConnectionId: new Map(),
    nowMs,
    marathonActive: true,
    maxByteStallMs: 286_504,
    httpParentChainAgeMs: 600_000,
    outboundHy2SessionAgeMs: 600_000,
    registry: { records: new Map() },
  })
  const ok =
    plan.reason !== 'marathon_active_zero_data_plane_mutation' &&
    plan.reason !== 'missing_current_request_bound_stall_proof'
  return {
    fixtureId: '0806_frozen_prune_byte_death_bypass',
    ok,
    detail: ok
      ? `byte-death stall proof reached carrier gate (plan=${plan.action}/${plan.reason})`
      : `still blocked at ${plan.reason}`,
  }
}

/** 8/6: SEL R2 parent_udp_refresh must resolve untracked UDP at cursor_conn=158. */
export function replayBug20260806SelR2RotationChainHop(): Bug20260806ReplayVerdict {
  const nowMs = 2_000_000
  const plan = resolveHy2ParentRotationAfterPrunePlan({
    snapshot: {
      schemaVersion: 2,
      updatedAtMs: nowMs,
      cursorConnectionCount: 158,
      httpParentChainAgeMs: 5493,
      outboundHy2SessionAgeMs: 5493,
      maxByteStallMs: 286_504,
      frozenQuicCursorCount: 10,
      activeHy2Leaf: 'JP-VPS-HY2',
    },
    connections: [
      {
        id: 'udp-untracked-0806',
        chains: ['JP-VPS-HY2'],
        metadata: { network: 'udp' },
      } as ControllerConnectionDetail,
    ],
    trackedFirstSeenAtMsById: new Map(),
    trackedLastByteChangeAtMsById: new Map([['udp-untracked-0806', nowMs - 5493]]),
    lastRotationAtMs: nowMs - 30_000,
    nowMs,
    emergencyStallEscalation: true,
    marathonGlobalByteDeath: true,
  })
  const ok =
    plan.action === 'close_udp_outbound' &&
    plan.udpConnectionId === 'udp-untracked-0806' &&
    plan.reason.startsWith('parent_session_refresh_after_prune')
  return {
    fixtureId: '0806_sel_r2_rotation_chain_hop',
    ok,
    detail: ok
      ? 'SEL R2 rotation closes untracked UDP parent at byte-death'
      : `plan action=${plan.action} reason=${plan.reason} id=${plan.udpConnectionId ?? 'none'}`,
  }
}

/** C-8.9: byte-death + mihomo omits UDP rows must expose diagnostics for leaf fallback. */
export function replayBug20260806NoUdpFullScanDiagnostics(): Bug20260806ReplayVerdict {
  const nowMs = 2_000_000
  const resolution = resolveHy2ParentUdpOutboundConnectionId({
    connections: [
      {
        id: 'tcp-cursor',
        chains: ['JP-VPS-HY2'],
        metadata: { network: 'tcp', host: 'api2.cursor.sh' },
      } as ControllerConnectionDetail,
    ],
    activeLeaf: 'JP-VPS-HY2',
    trackedFirstSeenAtMsById: new Map(),
    nowMs,
    byteDeathFullScan: true,
  })
  const ok =
    resolution.source === 'none' &&
    resolution.diagnostics?.udpFullScanCandidates === 0 &&
    resolution.diagnostics?.totalConnections === 1
  return {
    fixtureId: '0806_no_udp_full_scan_diagnostics',
    ok,
    detail: ok
      ? 'byte-death full scan exposes diagnostics when mihomo omits UDP parent rows'
      : `resolution source=${resolution.source} diagnostics=${JSON.stringify(resolution.diagnostics)}`,
  }
}

/** C-8.11: eadc68de no-UDP prod pattern must plan surgical frozen leaf batch. */
export function replayBug20260806Eadc68deLeafClosePlan(): Bug20260806ReplayVerdict {
  const nowMs = 2_000_000
  const connections = Array.from({ length: 94 }, (_, index) => ({
    id: `tcp-${index}`,
    chains: ['Cursor专用', 'JP-VPS-HY2'],
    metadata: { network: 'tcp', host: 'api2.cursor.sh' },
  })) as ControllerConnectionDetail[]
  const trackedLastByteChangeAtMsById = new Map(
    connections.map((conn) => [conn.id, nowMs - 120_000]),
  )
  const plan = planByteDeathParentMutation({
    connections,
    activeLeaf: 'JP-VPS-HY2',
    trackedFirstSeenAtMsById: new Map(),
    trackedLastByteChangeAtMsById,
    nowMs,
  })
  const leafTargets = selectByteDeathLeafCloseTargets({
    connections,
    activeLeaf: 'JP-VPS-HY2',
    trackedLastByteChangeAtMsById,
    nowMs,
  })
  const ok =
    plan.action === 'close_leaf_connections' &&
    plan.reason === 'byte_death_close_frozen_leaf_batch' &&
    plan.leafTargetCount === 8 &&
    leafTargets.length === 8
  return {
    fixtureId: 'eadc68de_no_udp_leaf_close_plan',
    ok,
    detail: ok
      ? 'C-8.11 SSOT plans surgical batch (8) for 94 frozen HY2 TCP when mihomo omits UDP rows'
      : `plan action=${plan.action} reason=${plan.reason} batch=${leafTargets.length} targetCount=${plan.leafTargetCount ?? 'none'}`,
  }
}

/** C-8.9/10: ghost_udp paths deleted; byte-death SSOT lives in hy2ParentByteDeathRecovery*. */
export function replayBug20260806GhostUdpDeleted(): Bug20260806ReplayVerdict {
  const sidecarPath = join(process.cwd(), 'src/main/core/hy2ParentSidecar.ts')
  const sidecar = readFileSync(sidecarPath, 'utf8')
  const recoveryPath = join(process.cwd(), 'src/main/core/mihomoQuicSilentStallRecovery.ts')
  const recovery = readFileSync(recoveryPath, 'utf8')
  const corePath = join(process.cwd(), 'src/main/core/hy2ParentByteDeathRecoveryCore.ts')
  const core = readFileSync(corePath, 'utf8')
  const forbidden = [
    'ghost_udp',
    'byte_death_ghost_udp',
    'ghost_udp_parent_birth_reset',
    'executeByteDeathNoUdpFallback',
  ]
  const requiredSidecar = [
    'executeByteDeathParentMutation',
    'byte_death_mutation_failed_blocking_sidecar',
  ]
  const requiredRecovery = [
    'executeByteDeathParentMutation',
    'byte_death_rotation_ssot',
    'isByteDeathNoUdpRotationSkip',
  ]
  const requiredCore = [
    'planByteDeathParentMutation',
    'chainsReferenceActiveLeaf',
    'selectByteDeathLeafCloseTargets',
    '[Hy2ParentByteDeathRecovery]:',
  ]
  const hit = forbidden.find((token) => sidecar.includes(token) || recovery.includes(token))
  const missingSidecar = requiredSidecar.find((token) => !sidecar.includes(token))
  const missingRecovery = requiredRecovery.find((token) => !recovery.includes(token))
  const missingCore = requiredCore.find((token) => !core.includes(token))
  const ok = hit == null && missingSidecar == null && missingRecovery == null && missingCore == null
  return {
    fixtureId: '0806_ghost_udp_deleted',
    ok,
    detail: ok
      ? 'C-8.11 SSOT wired in sidecar + SEL rotation; no ghost_udp or legacy fallback'
      : hit != null
        ? `forbidden token still present: ${hit}`
        : missingSidecar != null
          ? `sidecar missing: ${missingSidecar}`
          : missingRecovery != null
            ? `recovery missing: ${missingRecovery}`
            : `core missing: ${missingCore}`,
  }
}

export function runBug20260806ControlPlaneReplayGate(): Bug20260806ControlPlaneReplayResult {
  const verdicts = [
    replayBug20260806HighConnUdpChainHop(),
    replayBug20260806ConnectPartitionEmergencyAdmission(),
    replayBug20260806FrozenPruneByteDeathBypass(),
    replayBug20260806SelR2RotationChainHop(),
    replayBug20260806NoUdpFullScanDiagnostics(),
    replayBug20260806Eadc68deLeafClosePlan(),
    replayBug20260806GhostUdpDeleted(),
  ]
  return {
    ok: verdicts.every((verdict) => verdict.ok),
    verdicts,
  }
}
