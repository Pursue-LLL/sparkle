import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  getLastHy2ParentSidecarDetectLogAtMsForTests,
  resetHy2ParentSidecarStateForTests,
} from './hy2ParentSidecar'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

describe('hy2ParentSidecar R-35a execute', () => {
  it('source executes sidecar dial and UDP outbound refresh', () => {
    const source = readFileSync(path.join(ROOT, 'hy2ParentSidecar.ts'), 'utf8')
    assert.match(source, /runHy2TunnelVitalityIfDue/)
    assert.match(source, /mihomoCloseConnection/)
    assert.match(source, /phase=execute/)
    assert.doesNotMatch(source, /phase=detect_only/)
    assert.match(source, /executeByteDeathParentMutation/)
    assert.match(source, /byte_death_mutation_failed_blocking_sidecar/)
    assert.match(source, /trackedLastByteChangeAtMsById/)
  })

  it('reports the actual sidecar outcome to the escalation caller', () => {
    const source = readFileSync(path.join(ROOT, 'mihomoQuicSilentStallRecovery.ts'), 'utf8')
    assert.match(source, /const sidecar = await runHy2ParentSidecarIfDue/)
    assert.match(source, /outcome: sidecar\.outcome/)
    assert.match(source, /if \(sidecar\.outcome === 'executed'\)/)
  })

  it('exposes sidecar action state helpers for tests', () => {
    resetHy2ParentSidecarStateForTests()
    assert.equal(getLastHy2ParentSidecarDetectLogAtMsForTests(), 0)
  })

  it('SEL rotation path wires byte-death SSOT when rotation finds no_udp_outbound', () => {
    const source = readFileSync(
      path.join(ROOT, 'mihomoQuicSilentStallRecovery.ts'),
      'utf8',
    )
    assert.match(source, /executeByteDeathParentMutation/)
    assert.match(source, /byte_death_rotation_ssot/)
  })
})
