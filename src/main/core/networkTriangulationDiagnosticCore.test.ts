import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  API2_PROBE_TARGET,
  SPLIT_BRAIN_CONTROL_TARGET
} from './cursorTransportHealthCore'
import {
  buildTriangulationProbePlan,
  resolveTriangulationVerdict,
  TRIANGULATION_JP_NODE,
  TRIANGULATION_KR_NODE,
  type TriangulationInput
} from './networkTriangulationDiagnosticCore'

function okProbe(proxy: string, target: string, delayMs: number) {
  return { proxy, target, ok: true, delayMs }
}

function failProbe(proxy: string, target: string) {
  return { proxy, target, ok: false, delayMs: 0, message: 'timeout' }
}

function skippedActive() {
  return {
    proxy: '(none)',
    target: API2_PROBE_TARGET,
    ok: false,
    delayMs: 0,
    skipped: true as const,
    skipReason: 'test'
  }
}

describe('networkTriangulationDiagnosticCore', () => {
  it('builds probe plan when both Reality nodes exist', () => {
    const plan = buildTriangulationProbePlan(
      new Set([TRIANGULATION_KR_NODE, TRIANGULATION_JP_NODE, 'KR-VPS-HY2']),
      'KR-VPS-HY2'
    )
    assert.equal(plan.kr.skipped, undefined)
    assert.equal(plan.jp.skipped, undefined)
    assert.equal(plan.active.proxy, 'KR-VPS-HY2')
    assert.equal(plan.marketplace.proxy, TRIANGULATION_KR_NODE)
    assert.equal(plan.marketplace.target, SPLIT_BRAIN_CONTROL_TARGET)
  })

  it('marks missing nodes as skipped', () => {
    const plan = buildTriangulationProbePlan(new Set([TRIANGULATION_JP_NODE]))
    assert.equal(plan.kr.skipped, true)
    assert.equal(plan.jp.skipped, undefined)
  })

  it('detects company network when marketplace ok but both api2 fail', () => {
    const input: TriangulationInput = {
      kr: failProbe(TRIANGULATION_KR_NODE, API2_PROBE_TARGET),
      jp: failProbe(TRIANGULATION_JP_NODE, API2_PROBE_TARGET),
      marketplace: okProbe(TRIANGULATION_KR_NODE, SPLIT_BRAIN_CONTROL_TARGET, 200),
      active: skippedActive()
    }
    const verdict = resolveTriangulationVerdict(input)
    assert.equal(verdict.layer, 'company_network_to_vps')
    assert.equal(verdict.confidence, 'definitive')
  })

  it('detects JP path degraded when KR ok', () => {
    const input: TriangulationInput = {
      kr: okProbe(TRIANGULATION_KR_NODE, API2_PROBE_TARGET, 180),
      jp: failProbe(TRIANGULATION_JP_NODE, API2_PROBE_TARGET),
      marketplace: okProbe(TRIANGULATION_KR_NODE, SPLIT_BRAIN_CONTROL_TARGET, 200),
      active: skippedActive()
    }
    const verdict = resolveTriangulationVerdict(input)
    assert.equal(verdict.layer, 'jp_path_degraded')
    assert.equal(verdict.confidence, 'definitive')
  })

  it('detects healthy paths when all probes ok', () => {
    const input: TriangulationInput = {
      kr: okProbe(TRIANGULATION_KR_NODE, API2_PROBE_TARGET, 180),
      jp: okProbe(TRIANGULATION_JP_NODE, API2_PROBE_TARGET, 220),
      marketplace: okProbe(TRIANGULATION_KR_NODE, SPLIT_BRAIN_CONTROL_TARGET, 200),
      active: okProbe('KR-VPS-HY2', API2_PROBE_TARGET, 360)
    }
    const verdict = resolveTriangulationVerdict(input)
    assert.equal(verdict.layer, 'paths_healthy')
    assert.equal(verdict.probeAttribution, 'healthy')
  })

  it('detects global outage when all probes fail', () => {
    const input: TriangulationInput = {
      kr: failProbe(TRIANGULATION_KR_NODE, API2_PROBE_TARGET),
      jp: failProbe(TRIANGULATION_JP_NODE, API2_PROBE_TARGET),
      marketplace: failProbe(TRIANGULATION_KR_NODE, SPLIT_BRAIN_CONTROL_TARGET),
      active: skippedActive()
    }
    const verdict = resolveTriangulationVerdict(input)
    assert.equal(verdict.layer, 'cursor_server_or_global')
    assert.equal(verdict.probeAttribution, 'offline')
  })

  it('detects active path degraded when Reality ok but active fails', () => {
    const input: TriangulationInput = {
      kr: okProbe(TRIANGULATION_KR_NODE, API2_PROBE_TARGET, 834),
      jp: okProbe(TRIANGULATION_JP_NODE, API2_PROBE_TARGET, 820),
      marketplace: okProbe(TRIANGULATION_KR_NODE, SPLIT_BRAIN_CONTROL_TARGET, 200),
      active: failProbe('KR-VPS-HY2', API2_PROBE_TARGET)
    }
    const verdict = resolveTriangulationVerdict(input)
    assert.equal(verdict.layer, 'active_path_degraded')
    assert.equal(verdict.confidence, 'definitive')
  })
})
