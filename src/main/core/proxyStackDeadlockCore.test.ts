import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateProxyStackDeadlockAdmission,
  isCollectiveLongflowDeath,
  measuredLongflowEvidence,
  selectLeafProbeTargets,
  unknownLongflowEvidence,
  PROXY_STACK_LONGFLOW_EVIDENCE_UNKNOWN,
  type ProxyStackDeadlockEvidence,
} from './proxyStackDeadlockCore'

const mixedPortAliveEvidence: ProxyStackDeadlockEvidence = {
  mixedPortApi2Ok: true,
  controllerReachable: true,
  leafProbes: [{ leaf: 'KR-VPS-HY2', ok: false }],
}

const healthyMeasurement = measuredLongflowEvidence({
  maxByteStallMs: 0,
  frozenQuicCursorCount: 0,
  cursorConnectionCount: 0,
})

describe('proxyStackDeadlockCore', () => {
  it('rejects restart when mixed-port api2 still works', () => {
    const verdict = evaluateProxyStackDeadlockAdmission(
      mixedPortAliveEvidence,
      healthyMeasurement,
    )
    assert.equal(verdict.confirmed, false)
    assert.equal(verdict.reason, 'proxy_stack_alive_mixed_port_api2')
  })

  it('confirms deadlock when mixed-port and controller both down', () => {
    const verdict = evaluateProxyStackDeadlockAdmission(
      { mixedPortApi2Ok: false, controllerReachable: false, leafProbes: [] },
      healthyMeasurement,
    )
    assert.equal(verdict.confirmed, true)
    assert.equal(verdict.reason, 'proxy_stack_deadlock_mixed_port_and_controller_down')
  })

  it('blocks restart when an alternate leaf still reaches api2', () => {
    const verdict = evaluateProxyStackDeadlockAdmission(
      {
        mixedPortApi2Ok: false,
        controllerReachable: true,
        leafProbes: [
          { leaf: 'KR-VPS-HY2', ok: false },
          { leaf: '🇸🇬 新加坡 02', ok: true },
        ],
      },
      healthyMeasurement,
    )
    assert.equal(verdict.confirmed, false)
    assert.equal(verdict.reason, 'proxy_stack_not_deadlock_alternate_leaf_reachable')
  })

  it('confirms deadlock when collective longflow overrides mixed-port veto (09-14 storm)', () => {
    const verdict = evaluateProxyStackDeadlockAdmission(
      mixedPortAliveEvidence,
      measuredLongflowEvidence({
        maxByteStallMs: 214_007,
        frozenQuicCursorCount: 28,
        cursorConnectionCount: 55,
      }),
    )
    assert.equal(verdict.confirmed, true)
    assert.equal(verdict.reason, 'proxy_stack_deadlock_longflow_overrides_mixed_port')
  })

  it('keeps mixed-port veto when longflow is below collective thresholds', () => {
    const verdict = evaluateProxyStackDeadlockAdmission(
      mixedPortAliveEvidence,
      measuredLongflowEvidence({
        maxByteStallMs: 46_503,
        frozenQuicCursorCount: 1,
        cursorConnectionCount: 12,
      }),
    )
    assert.equal(verdict.confirmed, false)
    assert.equal(verdict.reason, 'proxy_stack_alive_mixed_port_api2')
  })

  it('ADVERSARIAL: unknown evidence is reported explicitly, never scored as healthy zero', () => {
    const verdict = evaluateProxyStackDeadlockAdmission(
      mixedPortAliveEvidence,
      unknownLongflowEvidence('recovery_coordinator_no_longevity_snapshot'),
    )
    assert.equal(verdict.confirmed, false, 'unknown must not authorize a cold restart')
    assert.notEqual(verdict.reason, 'proxy_stack_alive_mixed_port_api2')
    assert.equal(
      verdict.reason,
      `${PROXY_STACK_LONGFLOW_EVIDENCE_UNKNOWN}:recovery_coordinator_no_longevity_snapshot`,
    )
  })

  it('ADVERSARIAL: non-finite measurement degrades to unknown, not to zero', () => {
    const evidence = measuredLongflowEvidence({
      maxByteStallMs: Number.NaN,
      frozenQuicCursorCount: 28,
      cursorConnectionCount: 55,
    })
    assert.equal(evidence.kind, 'unknown')
    const verdict = evaluateProxyStackDeadlockAdmission(mixedPortAliveEvidence, evidence)
    assert.equal(verdict.confirmed, false)
    assert.match(verdict.reason, /longflow_evidence_non_finite/)
  })

  it('ADVERSARIAL: negative measurement degrades to unknown', () => {
    const evidence = measuredLongflowEvidence({
      maxByteStallMs: -1_000,
      frozenQuicCursorCount: -1,
      cursorConnectionCount: -1,
    })
    assert.equal(evidence.kind, 'unknown')
  })

  it('isCollectiveLongflowDeath requires stall + frozen + cursor together', () => {
    assert.equal(isCollectiveLongflowDeath(unknownLongflowEvidence('no_data')), false)
    assert.equal(
      isCollectiveLongflowDeath(
        measuredLongflowEvidence({
          maxByteStallMs: 225_997,
          frozenQuicCursorCount: 2,
          cursorConnectionCount: 14,
        }),
      ),
      true,
    )
    assert.equal(
      isCollectiveLongflowDeath(
        measuredLongflowEvidence({
          maxByteStallMs: 225_997,
          frozenQuicCursorCount: 1,
          cursorConnectionCount: 61,
        }),
      ),
      false,
    )
    assert.equal(
      isCollectiveLongflowDeath(
        measuredLongflowEvidence({
          maxByteStallMs: 149_999,
          frozenQuicCursorCount: 28,
          cursorConnectionCount: 61,
        }),
      ),
      false,
    )
  })

  it('ADVERSARIAL: never fabricate leaf probe failures when controller is unreachable', () => {
    assert.deepEqual(selectLeafProbeTargets(false, ['KR-VPS-HY2', '自动选择', 'DIRECT']), [])
    assert.deepEqual(selectLeafProbeTargets(true, ['KR-VPS-HY2', '自动选择', 'DIRECT']), [
      'KR-VPS-HY2',
      '自动选择',
      'DIRECT',
    ])
  })

  it('confirms deadlock when mixed-port fails and all sampled leaves fail', () => {
    const verdict = evaluateProxyStackDeadlockAdmission(
      {
        mixedPortApi2Ok: false,
        controllerReachable: true,
        leafProbes: [
          { leaf: 'KR-VPS-HY2', ok: false },
          { leaf: 'KR-VPS-Reality', ok: false },
        ],
      },
      healthyMeasurement,
    )
    assert.equal(verdict.confirmed, true)
    assert.equal(verdict.reason, 'proxy_stack_deadlock_all_sampled_leaves_failed')
  })
})
