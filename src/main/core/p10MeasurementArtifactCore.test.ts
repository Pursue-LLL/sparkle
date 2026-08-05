import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computePerSamplePairedTaxPercentiles, percentileMs } from './p10MeasurementArtifactCore'
import { runP10TunLatencyGate } from './p10TunLatencyGateCore'

describe('p10MeasurementArtifactCore paired tax', () => {
  it('computes per-sample paired tax percentiles', () => {
    const paired = computePerSamplePairedTaxPercentiles({
      tunMs: [60, 80, 120],
      mixedMs: [10, 20, 30]
    })
    assert.equal(paired.samples, 3)
    assert.equal(paired.p50Ms, 60)
    assert.equal(paired.p95Ms, 90)
  })

  it('percentileMs returns rounded index value', () => {
    assert.equal(percentileMs([10, 20, 30, 40], 50), 20)
  })
})

describe('p10TunLatencyGateCore per-sample paired tax', () => {
  it('reports insufficient samples separately from excess latency tax', () => {
    const gate = runP10TunLatencyGate({
      artifact: {
        meta: {
          schemaVersion: 'p10-measurement-artifact.v1',
          capturedAtIso: '2026-08-01T00:00:00.000Z',
          source: 'test',
          sha256: 'a'.repeat(64)
        },
        payload: {
          samples: 30,
          tun: { p50Ms: 371, p95Ms: 433 },
          mixedPort: { p50Ms: 380, p95Ms: 437 },
          pairedTax: { samples: 30, p50Ms: -15, p95Ms: 57 },
          maxTunP50TaxMs: 50,
          maxTunP95TaxMs: 100
        }
      }
    })
    assert.equal(gate.ok, false)
    assert.equal(gate.detail, 'insufficient samples=30/100')
  })

  it('prefers per-sample pairedTax when samples>=100', () => {
    const gate = runP10TunLatencyGate({
      artifact: {
        meta: {
          schemaVersion: 'p10-measurement-artifact.v1',
          capturedAtIso: '2026-08-01T00:00:00.000Z',
          source: 'test',
          sha256: 'a'.repeat(64)
        },
        payload: {
          samples: 100,
          tun: { p50Ms: 200, p95Ms: 400 },
          mixedPort: { p50Ms: 10, p95Ms: 20 },
          pairedTax: { samples: 100, p50Ms: 40, p95Ms: 70 },
          maxTunP50TaxMs: 50,
          maxTunP95TaxMs: 100
        }
      }
    })
    assert.equal(gate.ok, true)
    assert.equal(gate.p50TaxMs, 40)
    assert.equal(gate.p95TaxMs, 70)
  })
})
