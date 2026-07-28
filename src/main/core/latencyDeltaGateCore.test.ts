import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateLatencyDeltaFromSummary } from './latencyDeltaGateCore'

describe('latencyDeltaGateCore', () => {
  it('returns high=false when samples insufficient', () => {
    const result = evaluateLatencyDeltaFromSummary({
      vpsBodyP50: 300,
      vpsBodySamples: 2,
      macFullPathP50: 520,
      macFullPathSamples: 2,
    })
    assert.equal(result.high, false)
    assert.equal(result.deltaMs, null)
  })

  it('flags high delta when mac path exceeds vps by threshold', () => {
    const result = evaluateLatencyDeltaFromSummary({
      vpsBodyP50: 300,
      vpsBodySamples: 6,
      macFullPathP50: 520,
      macFullPathSamples: 6,
    })
    assert.equal(result.high, true)
    assert.equal(result.deltaMs, 220)
  })
})
