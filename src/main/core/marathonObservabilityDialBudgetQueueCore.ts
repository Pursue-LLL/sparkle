// [INPUT] marathonObservabilityDialBudgetCore
// [OUTPUT] runMarathonObservabilityDialBudget · resetMarathonObservabilityDialBudgetQueueForTests
// [POS] P12 纯队列：无 Electron 依赖，单测可直跑。

import {
  canObservabilityDialPreemptInFlight,
  shouldApplyMarathonObservabilityDialBudget,
  shouldSkipObservabilityDialWhenBusy,
  type MarathonObservabilityDialContext,
  type ObservabilityDialKind,
} from './marathonObservabilityDialBudgetCore'

export type MarathonObservabilityDialOutcome = 'ran' | 'skipped_busy' | 'passthrough'

export interface MarathonObservabilityDialResult<T> {
  outcome: MarathonObservabilityDialOutcome
  value: T | null
}

let queueTail: Promise<void> = Promise.resolve()
let activeKind: ObservabilityDialKind | null = null
let activeDialCount = 0

export async function runMarathonObservabilityDialBudget<T>(
  kind: ObservabilityDialKind,
  context: MarathonObservabilityDialContext,
  fn: () => Promise<T>,
  onSkip?: (kind: ObservabilityDialKind, context: MarathonObservabilityDialContext) => void,
): Promise<MarathonObservabilityDialResult<T>> {
  if (!shouldApplyMarathonObservabilityDialBudget(context)) {
    const value = await fn()
    return { outcome: 'passthrough', value }
  }

  if (
    shouldSkipObservabilityDialWhenBusy(kind) &&
    activeDialCount > 0 &&
    !canObservabilityDialPreemptInFlight(kind, activeKind)
  ) {
    onSkip?.(kind, context)
    return { outcome: 'skipped_busy', value: null }
  }

  let releaseGate!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve
  })
  const previous = queueTail
  queueTail = gate
  await previous

  if (
    shouldSkipObservabilityDialWhenBusy(kind) &&
    activeDialCount > 0 &&
    !canObservabilityDialPreemptInFlight(kind, activeKind)
  ) {
    onSkip?.(kind, context)
    releaseGate()
    return { outcome: 'skipped_busy', value: null }
  }

  activeKind = kind
  activeDialCount += 1
  try {
    const value = await fn()
    return { outcome: 'ran', value }
  } finally {
    activeDialCount -= 1
    if (activeDialCount === 0) {
      activeKind = null
    }
    releaseGate()
  }
}

export function resetMarathonObservabilityDialBudgetQueueForTests(): void {
  queueTail = Promise.resolve()
  activeKind = null
  activeDialCount = 0
}

export function getMarathonObservabilityDialBudgetQueueStateForTests(): {
  activeKind: ObservabilityDialKind | null
  activeDialCount: number
} {
  return { activeKind, activeDialCount }
}
