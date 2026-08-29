// [INPUT] core footprint signals (child, pid, socket probe, service restart intent)
// [OUTPUT] resolveStartCoreWouldMutateDataPlane — Layer-0 SSOT for startCore marathon guard
// [POS] BUG-2026-08-29-001 P0 — block startCore before any stop/replace of live mihomo

import type { CoreStartFootprintDecision } from './staleMihomoApiSocketCore'

export type StartCoreMutationReason =
  | 'elevated_child_running'
  | 'protected_existing_core_footprint'
  | 'service_core_restart'

export interface StartCoreMutationIntent {
  wouldMutate: boolean
  reason: StartCoreMutationReason | 'no_live_core'
}

export function resolveStartCoreMutationFromFootprint(
  footprint: CoreStartFootprintDecision,
): StartCoreMutationIntent {
  if (!footprint.blockStart) {
    return { wouldMutate: false, reason: 'no_live_core' }
  }
  if (footprint.reason === 'protected_existing_core') {
    return { wouldMutate: true, reason: 'protected_existing_core_footprint' }
  }
  return { wouldMutate: false, reason: 'no_live_core' }
}

export function resolveElevatedStartCoreMutationIntent(input: {
  hasChildProcess: boolean
  footprint: CoreStartFootprintDecision
}): StartCoreMutationIntent {
  if (input.hasChildProcess) {
    return { wouldMutate: true, reason: 'elevated_child_running' }
  }
  return resolveStartCoreMutationFromFootprint(input.footprint)
}

export function resolveServiceStartCoreMutationIntent(
  serviceCoreLaunchAction: 'keep' | 'start' | 'restart',
): StartCoreMutationIntent {
  if (serviceCoreLaunchAction === 'restart') {
    return { wouldMutate: true, reason: 'service_core_restart' }
  }
  return { wouldMutate: false, reason: 'no_live_core' }
}
