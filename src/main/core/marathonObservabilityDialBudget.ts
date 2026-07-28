// [INPUT] marathonObservabilityDialBudgetQueueCore · cursorConnectionHygiene · marathonQuiesce · log
// [OUTPUT] withMarathonObservabilityDialBudget · resolveMarathonObservabilityDialContext
// [POS] P12 Electron 包装：解析 context + skip 日志。

import { appendAppLog } from '../utils/log'
import { countCursorConnections } from './cursorConnectionHygiene'
import { getMarathonQuiesceSnapshot } from './marathonQuiesce'
import {
  runMarathonObservabilityDialBudget,
  type MarathonObservabilityDialResult,
} from './marathonObservabilityDialBudgetQueueCore'
import type {
  MarathonObservabilityDialContext,
  ObservabilityDialKind,
} from './marathonObservabilityDialBudgetCore'

export type { MarathonObservabilityDialOutcome, MarathonObservabilityDialResult } from './marathonObservabilityDialBudgetQueueCore'

export async function resolveMarathonObservabilityDialContext(): Promise<MarathonObservabilityDialContext> {
  const quiesceSnapshot = getMarathonQuiesceSnapshot()
  return {
    cursorConnectionCount: await countCursorConnections(),
    quiesceActive: quiesceSnapshot.active,
  }
}

function logSkip(kind: ObservabilityDialKind, context: MarathonObservabilityDialContext): void {
  void appendAppLog(
    `[MarathonObservabilityDialBudget]: skip kind=${kind} cursor_conn=${context.cursorConnectionCount} quiesce=${context.quiesceActive ? 1 : 0}\n`,
  )
}

export async function withMarathonObservabilityDialBudget<T>(
  kind: ObservabilityDialKind,
  context: MarathonObservabilityDialContext,
  fn: () => Promise<T>,
): Promise<MarathonObservabilityDialResult<T>> {
  return runMarathonObservabilityDialBudget(kind, context, fn, logSkip)
}

export {
  getMarathonObservabilityDialBudgetQueueStateForTests,
  resetMarathonObservabilityDialBudgetQueueForTests,
} from './marathonObservabilityDialBudgetQueueCore'
