// [INPUT] mixed-port · controller · multi-leaf probe results
// [OUTPUT] evaluateProxyStackDeadlockAdmission
// [POS] SSOT — emergency core restart only when proxy stack is dead (no leaf path works).

/** Minimum distinct leaves probed before all-fail qualifies as stack deadlock. */
export const PROXY_STACK_DEADLOCK_MIN_LEAF_SAMPLES = 2

export interface ProxyStackLeafProbe {
  leaf: string
  ok: boolean
}

export interface ProxyStackDeadlockEvidence {
  mixedPortApi2Ok: boolean
  controllerReachable: boolean
  leafProbes: readonly ProxyStackLeafProbe[]
}

/**
 * Collective long-flow death proof — short mixed-port probes stay green while
 * long-lived carriers (api2 SSE/QUIC) are byte-frozen. When all three hold,
 * the long flow outranks the short probe (split-brain).
 *
 * Evidence contract: a discriminated union, never optional numbers. Missing or
 * non-finite data must be modelled as `unknown`, so "not measured" can never be
 * silently scored as "healthy zero" (`?? 0` class defects).
 */
export type LongflowEvidence =
  | {
      kind: 'measured'
      maxByteStallMs: number
      frozenQuicCursorCount: number
      cursorConnectionCount: number
    }
  | { kind: 'unknown'; reason: string }

export function measuredLongflowEvidence(input: {
  maxByteStallMs: number
  frozenQuicCursorCount: number
  cursorConnectionCount: number
}): LongflowEvidence {
  const values = [input.maxByteStallMs, input.frozenQuicCursorCount, input.cursorConnectionCount]
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) {
    return { kind: 'unknown', reason: 'longflow_evidence_non_finite' }
  }
  return {
    kind: 'measured',
    maxByteStallMs: input.maxByteStallMs,
    frozenQuicCursorCount: input.frozenQuicCursorCount,
    cursorConnectionCount: input.cursorConnectionCount,
  }
}

export function unknownLongflowEvidence(reason: string): LongflowEvidence {
  return { kind: 'unknown', reason }
}

/** Byte stall proving carrier death (09-09 incident: 178s→225s climbing). */
export const PROXY_STACK_LONGFLOW_BYPASS_STALL_MS = 150_000
/** Minimum frozen QUIC cursor cluster (09-09: 1→3, 09-14 storm: 28). */
export const PROXY_STACK_LONGFLOW_BYPASS_FROZEN = 2
/** Minimum cursor fan-out to qualify as collective (09-09: 14~27, 09-14: 55~61). */
export const PROXY_STACK_LONGFLOW_BYPASS_CURSOR = 10

export const PROXY_STACK_LONGFLOW_EVIDENCE_UNKNOWN =
  'proxy_stack_longflow_evidence_unknown'

export function isCollectiveLongflowDeath(evidence: LongflowEvidence): boolean {
  if (evidence.kind !== 'measured') {
    return false
  }
  return (
    evidence.maxByteStallMs >= PROXY_STACK_LONGFLOW_BYPASS_STALL_MS &&
    evidence.frozenQuicCursorCount >= PROXY_STACK_LONGFLOW_BYPASS_FROZEN &&
    evidence.cursorConnectionCount >= PROXY_STACK_LONGFLOW_BYPASS_CURSOR
  )
}

/**
 * Leaf probes are only meaningful when the controller answered. Without it a
 * probe would report a fabricated `fail`, which previously produced the
 * misleading `leaf_probes=KR:fail,自动选择:fail,DIRECT:fail` "everything is
 * down" impression. Report no targets instead of fabricating failures.
 */
export function selectLeafProbeTargets(
  controllerReachable: boolean,
  leafNames: readonly string[],
): readonly string[] {
  return controllerReachable ? leafNames : []
}

export function evaluateProxyStackDeadlockAdmission(
  evidence: ProxyStackDeadlockEvidence,
  longflow: LongflowEvidence,
): { confirmed: boolean; reason: string } {
  if (evidence.mixedPortApi2Ok && !isCollectiveLongflowDeath(longflow)) {
    if (longflow.kind === 'unknown') {
      return {
        confirmed: false,
        reason: `${PROXY_STACK_LONGFLOW_EVIDENCE_UNKNOWN}:${longflow.reason}`,
      }
    }
    return { confirmed: false, reason: 'proxy_stack_alive_mixed_port_api2' }
  }
  if (evidence.mixedPortApi2Ok) {
    return {
      confirmed: true,
      reason: 'proxy_stack_deadlock_longflow_overrides_mixed_port',
    }
  }

  if (!evidence.controllerReachable) {
    return {
      confirmed: true,
      reason: 'proxy_stack_deadlock_mixed_port_and_controller_down',
    }
  }

  const probed = evidence.leafProbes.filter((entry) => entry.leaf.trim().length > 0)
  if (probed.length === 0) {
    return { confirmed: false, reason: 'proxy_stack_deadlock_insufficient_leaf_probes' }
  }

  if (probed.some((entry) => entry.ok)) {
    return {
      confirmed: false,
      reason: 'proxy_stack_not_deadlock_alternate_leaf_reachable',
    }
  }

  if (probed.length >= PROXY_STACK_DEADLOCK_MIN_LEAF_SAMPLES) {
    return {
      confirmed: true,
      reason: 'proxy_stack_deadlock_all_sampled_leaves_failed',
    }
  }

  return { confirmed: false, reason: 'proxy_stack_deadlock_insufficient_failed_leaves' }
}

export function formatLongflowEvidenceForLog(evidence: LongflowEvidence): string {
  if (evidence.kind === 'unknown') {
    return `longflow=unknown reason=${evidence.reason}`
  }
  return (
    `longflow_stall_ms=${evidence.maxByteStallMs}` +
    ` frozen=${evidence.frozenQuicCursorCount}` +
    ` cursor=${evidence.cursorConnectionCount}`
  )
}

export function formatProxyStackDeadlockLogLine(input: {
  outcome: 'probe' | 'blocked' | 'confirmed'
  reason: string
  mixedPortApi2Ok?: boolean
  controllerReachable?: boolean
  leafProbeSummary?: string
  longflowEvidence?: LongflowEvidence
}): string {
  const parts = [
    `[ProxyStackDeadlock]: outcome=${input.outcome}`,
    `reason=${input.reason}`,
  ]
  if (input.mixedPortApi2Ok != null) {
    parts.push(`mixed_port_api2=${input.mixedPortApi2Ok ? 1 : 0}`)
  }
  if (input.controllerReachable != null) {
    parts.push(`controller=${input.controllerReachable ? 1 : 0}`)
  }
  if (input.leafProbeSummary) {
    parts.push(`leaf_probes=${input.leafProbeSummary}`)
  }
  if (input.longflowEvidence) {
    parts.push(formatLongflowEvidenceForLog(input.longflowEvidence))
  }
  return `${parts.join(' ')}\n`
}
