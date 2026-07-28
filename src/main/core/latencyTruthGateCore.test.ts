import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateLatencyDeltaFromSummary } from './latencyDeltaGateCore'
import { formatLatencyTruthGateLogLine, resolveSparkleLatencyTaxFlag } from './latencyTruthGateCore'
import type { LatencyTruthSummary } from './latencyTruthFromLedgerCore'

describe('latencyTruthGateCore', () => {
  it('formats dual-track log line', () => {
    const summary: LatencyTruthSummary = {
      macFullPathP50: 271,
      macFullPathSamples: 437,
      vpsBodyP50: 519,
      vpsBodySamples: 277,
    }
    const gate = evaluateLatencyDeltaFromSummary(summary)
    const line = formatLatencyTruthGateLogLine('JP-VPS-HY2', summary, gate)
    assert.match(line, /mac_p50=271/)
    assert.match(line, /vps_p50=519/)
    assert.match(line, /high=0/)
    assert.equal(resolveSparkleLatencyTaxFlag(gate), 0)
  })

  it('flags SPARKLE_LATENCY_TAX when mac exceeds vps by >150ms', () => {
    const summary: LatencyTruthSummary = {
      macFullPathP50: 520,
      macFullPathSamples: 6,
      vpsBodyP50: 300,
      vpsBodySamples: 6,
    }
    const gate = evaluateLatencyDeltaFromSummary(summary)
    assert.equal(gate.high, true)
    assert.equal(resolveSparkleLatencyTaxFlag(gate), 1)
  })
})
