import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  resolveMarathonDialToleranceApplySec,
  resolveMarathonDialTolerancePendingTarget,
  shouldApplyMarathonDialToleranceNow,
  shouldDeferMarathonDialToleranceApply,
} from './marathonDialToleranceIdleApplyCore'

describe('marathonDialToleranceIdleApplyCore', () => {
  it('defers when conn≥12', () => {
    assert.equal(shouldDeferMarathonDialToleranceApply(20, false, false), true)
  })

  it('defers when active marathon stream even if conn<12', () => {
    assert.equal(shouldDeferMarathonDialToleranceApply(5, true, false), true)
  })

  it('defers when quiesce hysteresis active', () => {
    assert.equal(shouldDeferMarathonDialToleranceApply(5, false, true), true)
  })

  it('allows apply when idle and conn<12', () => {
    assert.equal(shouldDeferMarathonDialToleranceApply(5, false, false), false)
  })

  it('shouldApplyMarathonDialToleranceNow is false while deferred even with pending target', () => {
    const context = {
      cursorConnectionCount: 5,
      hasActiveMarathonStream: true,
      quiesceActive: false,
      targetDialTimeoutSec: 5,
      lastAppliedDialTimeoutSec: 45,
      pendingDialTimeoutSec: 5,
    }
    assert.equal(shouldApplyMarathonDialToleranceNow(context), false)
  })

  it('shouldApplyMarathonDialToleranceNow is true after stream ends with pending 5s', () => {
    const context = {
      cursorConnectionCount: 5,
      hasActiveMarathonStream: false,
      quiesceActive: false,
      targetDialTimeoutSec: 5,
      lastAppliedDialTimeoutSec: 45,
      pendingDialTimeoutSec: 5,
    }
    assert.equal(shouldApplyMarathonDialToleranceNow(context), true)
    assert.equal(resolveMarathonDialToleranceApplySec(context), 5)
  })

  it('resolveMarathonDialTolerancePendingTarget tracks latest target while deferred', () => {
    assert.equal(resolveMarathonDialTolerancePendingTarget(45, true, undefined), 45)
    assert.equal(resolveMarathonDialTolerancePendingTarget(5, true, 45), 5)
    assert.equal(resolveMarathonDialTolerancePendingTarget(5, false, 45), undefined)
  })
})
