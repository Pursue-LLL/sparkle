import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('verify-marathon-data-plane-soak-gate script', () => {
  it('defines core start violation markers and guard T0 markers', () => {
    const src = readFileSync(
      join(import.meta.dirname, 'verify-marathon-data-plane-soak-gate.mts'),
      'utf-8',
    )
    assert.match(src, /mihomo core started/)
    assert.match(src, /deferred data_plane_mutation_blocked/)
    assert.match(src, /verify-marathon-data-plane-soak-gate.*PASS/)
  })
})
