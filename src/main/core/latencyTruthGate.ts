// [INPUT] api2ProbeLedgerCore · latencyTruthGateCore · cursorDedicatedNodeResolver
// [OUTPUT] maybeEmitLatencyTruthGateLog
// [POS] P20a executor: emit [LatencyTruth] app-log on VPS L4 probe cycle.

import { appendAppLog } from '../utils/log'
import { readLatencyTruthSummaryForNode } from './api2ProbeLedgerCore'
import { evaluateLatencyDeltaFromSummary } from './latencyDeltaGateCore'
import { formatLatencyTruthGateLogLine } from './latencyTruthGateCore'
import { resolveCursorDedicatedActiveNode } from './cursorDedicatedNodeResolver'

export async function maybeEmitLatencyTruthGateLog(): Promise<void> {
  const activeNode = await resolveCursorDedicatedActiveNode()
  if (!activeNode) {
    return
  }
  const summary = await readLatencyTruthSummaryForNode(activeNode)
  const gate = evaluateLatencyDeltaFromSummary(summary)
  await appendAppLog(`${formatLatencyTruthGateLogLine(activeNode, summary, gate)}\n`)
}
