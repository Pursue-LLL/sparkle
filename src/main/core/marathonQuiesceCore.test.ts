import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MARATHON_QUIESCE_EXIT_HYSTERESIS_MS,
  advanceMarathonQuiesceState,
  createInitialMarathonQuiesceState,
  filterProxyDelayHistoryForMarathonDisplay,
  isBurstProbeActiveUnderMarathonQuiesce,
  shouldAllowObservabilityDial,
  shouldDeferConnectStreamKeepaliveUnderQuiesce,
  shouldDeferProbeForCursorLoadUnderMarathonQuiesce,
  shouldForceMandatoryRealProbeUnderMarathonQuiesce,
  shouldPauseProxyHealthMonitorUnderQuiesce,
  shouldShowMarathonQuiesceDelayBadge,
} from './marathonQuiesceCore'

describe('marathonQuiesceCore', () => {
  it('enters quiesce instantly at conn>=12', () => {
    const initial = createInitialMarathonQuiesceState()
    const result = advanceMarathonQuiesceState(12, initial, 1_000)
    assert.equal(result.entered, true)
    assert.equal(result.exited, false)
    assert.equal(result.state.active, true)
  })

  it('holds quiesce during exit hysteresis', () => {
    const active = { active: true, belowThresholdSinceMs: null }
    const atDrop = advanceMarathonQuiesceState(8, active, 10_000)
    assert.equal(atDrop.exited, false)
    assert.equal(atDrop.state.active, true)
    assert.equal(atDrop.state.belowThresholdSinceMs, 10_000)

    const beforeExit = advanceMarathonQuiesceState(
      8,
      atDrop.state,
      10_000 + MARATHON_QUIESCE_EXIT_HYSTERESIS_MS - 1,
    )
    assert.equal(beforeExit.state.active, true)

    const afterExit = advanceMarathonQuiesceState(
      8,
      atDrop.state,
      10_000 + MARATHON_QUIESCE_EXIT_HYSTERESIS_MS,
    )
    assert.equal(afterExit.exited, true)
    assert.equal(afterExit.state.active, false)
  })

  it('re-enters quiesce without waiting for hysteresis when conn rebounds', () => {
    const exiting = { active: true, belowThresholdSinceMs: 20_000 }
    const rebound = advanceMarathonQuiesceState(15, exiting, 25_000)
    assert.equal(rebound.entered, false)
    assert.equal(rebound.state.active, true)
    assert.equal(rebound.state.belowThresholdSinceMs, null)
  })

  it('pauses proxy health monitor while quiesce active (incl. exit hysteresis)', () => {
    assert.equal(shouldPauseProxyHealthMonitorUnderQuiesce(true), true)
    assert.equal(shouldPauseProxyHealthMonitorUnderQuiesce(false), false)
  })

  it('defers connect stream keepalive at conn>=80', () => {
    assert.equal(shouldDeferConnectStreamKeepaliveUnderQuiesce(79), false)
    assert.equal(shouldDeferConnectStreamKeepaliveUnderQuiesce(80), true)
  })

  it('blocks mandatory probe at conn>=80 unless TUN is latched lost', () => {
    const heavyContext = {
      cursorConnectionCount: 80,
      lastRealProbeAtMs: Date.now() - 120_000,
      hungConnectionCount: 3,
      tunInterfaceLostLatched: false,
      burstProbeActive: true,
    }
    assert.equal(shouldForceMandatoryRealProbeUnderMarathonQuiesce(false, heavyContext), false)
    assert.equal(shouldForceMandatoryRealProbeUnderMarathonQuiesce(true, heavyContext), false)
    assert.equal(
      shouldDeferProbeForCursorLoadUnderMarathonQuiesce(false, 80, heavyContext),
      true,
    )
    assert.equal(
      shouldDeferProbeForCursorLoadUnderMarathonQuiesce(true, 80, heavyContext),
      true,
    )

    const tunLost = { ...heavyContext, tunInterfaceLostLatched: true }
    assert.equal(shouldForceMandatoryRealProbeUnderMarathonQuiesce(true, tunLost), true)
    assert.equal(shouldDeferProbeForCursorLoadUnderMarathonQuiesce(true, 80, tunLost), false)
  })

  it('defers probe at conn 13 when quiesce active (P9s)', () => {
    const context = {
      cursorConnectionCount: 13,
      lastRealProbeAtMs: Date.now() - 120_000,
      hungConnectionCount: 0,
      tunInterfaceLostLatched: false,
      burstProbeActive: true,
    }
    assert.equal(shouldForceMandatoryRealProbeUnderMarathonQuiesce(true, context), false)
    assert.equal(shouldDeferProbeForCursorLoadUnderMarathonQuiesce(true, 13, context), true)
  })

  it('allows mandatory probe pierce at conn 20-79 when burst is active and quiesce off', () => {
    const context = {
      cursorConnectionCount: 25,
      lastRealProbeAtMs: Date.now() - 120_000,
      hungConnectionCount: 0,
      tunInterfaceLostLatched: false,
      burstProbeActive: true,
    }
    assert.equal(shouldForceMandatoryRealProbeUnderMarathonQuiesce(false, context), true)
    assert.equal(shouldDeferProbeForCursorLoadUnderMarathonQuiesce(false, 25, context), false)
  })

  it('defers probe at conn 20-79 when mandatory context is calm and quiesce off', () => {
    const context = {
      cursorConnectionCount: 25,
      lastRealProbeAtMs: Date.now(),
      hungConnectionCount: 0,
      tunInterfaceLostLatched: false,
      burstProbeActive: false,
    }
    assert.equal(shouldDeferProbeForCursorLoadUnderMarathonQuiesce(false, 25, context), true)
  })

  it('disables burst probe mode at conn>=80', () => {
    const burstUntil = Date.now() + 60_000
    assert.equal(isBurstProbeActiveUnderMarathonQuiesce(burstUntil, 79), true)
    assert.equal(isBurstProbeActiveUnderMarathonQuiesce(burstUntil, 80), false)
  })

  it('blocks observability dials when quiesce active at conn>=12', () => {
    assert.equal(
      shouldAllowObservabilityDial('provider_healthcheck_api', true, 13),
      false,
    )
    assert.equal(
      shouldAllowObservabilityDial('probe_cycle_transport', true, 13),
      false,
    )
    assert.equal(
      shouldAllowObservabilityDial('regional_url_test_warmup', true, 13),
      false,
    )
    assert.equal(
      shouldAllowObservabilityDial('marketplace_probe', true, 13),
      false,
    )
    assert.equal(
      shouldAllowObservabilityDial('provider_healthcheck_api', false, 13),
      true,
    )
  })

  it('blocks observability dials during exit hysteresis when conn<12 (P9i)', () => {
    assert.equal(
      shouldAllowObservabilityDial('provider_healthcheck_api', true, 8),
      false,
    )
    assert.equal(
      shouldAllowObservabilityDial('managed_ui_delay_test', true, 8),
      true,
    )
  })

  it('filters delay=0 bars when successful samples exist', () => {
    const history = [
      { delay: 320, time: 'a' },
      { delay: 0, time: 'b' },
      { delay: 0, time: 'c' },
    ]
    const filtered = filterProxyDelayHistoryForMarathonDisplay(history)
    assert.deepEqual(filtered.map((entry) => entry.delay), [320])
    assert.equal(shouldShowMarathonQuiesceDelayBadge(history), true)
  })

  it('keeps timeout-only history when no successful sample exists', () => {
    const history = [{ delay: 0, time: 'a' }]
    assert.deepEqual(filterProxyDelayHistoryForMarathonDisplay(history), history)
    assert.equal(shouldShowMarathonQuiesceDelayBadge(history), false)
  })
})
