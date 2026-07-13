import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveCommercialBenchmarkProbeUrl } from './commercialNodeBenchmark'

describe('commercialNodeBenchmark probe URLs', () => {
  it('uses api2 for VPS nodes', () => {
    assert.equal(resolveCommercialBenchmarkProbeUrl('vps'), 'https://api2.cursor.sh')
  })

  it('uses api2 for commercial nodes', () => {
    assert.equal(resolveCommercialBenchmarkProbeUrl('commercial'), 'https://api2.cursor.sh')
  })
})
