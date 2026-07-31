import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HY2_PARENT_SIDECAR_DIAL_AGE_MS,
  resolveHy2ParentSidecarDialPlan,
} from './hy2ParentSidecarCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

describe('hy2ParentSidecarCore R-35a', () => {
  const baseSnapshot: TransportLongevityTruthSnapshot = {
    schemaVersion: 1,
    updatedAtMs: 1_000_000,
    cursorConnectionCount: 33,
    httpParentChainAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1,
    outboundHy2SessionAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1,
    maxByteStallMs: 0,
    frozenQuicCursorCount: 0,
    activeHy2Leaf: 'JP-VPS-HY2',
  }

  it('triggers sidecar dial when marathon active and session aged', () => {
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: baseSnapshot,
      marathonTruthActive: true,
      lastSidecarDialAtMs: 0,
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'sidecar_dial')
    assert.equal(plan.reason, 'proactive_parent_sidecar_dial')
  })

  it('skips when marathon inactive', () => {
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: baseSnapshot,
      marathonTruthActive: false,
      lastSidecarDialAtMs: 0,
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'marathon_inactive')
  })

  it('respects sidecar cooldown', () => {
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: baseSnapshot,
      marathonTruthActive: true,
      lastSidecarDialAtMs: 1_000_000 - 60_000,
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'sidecar_cooldown')
  })
})
