import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canExecuteRecoveryLevel,
  decideRecoveryAction,
  describeRecoveryBlockReason,
  HUNG_CONNECTION_MIN_AGE_MS,
  isCriticalCursorHost,
  isHungCursorConnection,
  resolveProbeAttribution,
  selectHungCursorConnectionsToClose,
  shouldDeferDestructiveRecoveryAfterLiveProbe,
  shouldDeferProbeForCursorLoad,
  shouldExcludeProbeSampleFromNodeScoring,
  shouldForceMandatoryRealProbe
} from './cursorTransportHealthCore'
import type { ConnectionHygieneRow as HygieneRow } from './cursorConnectionHygieneCore'

const NOW = Date.parse('2026-07-09T02:41:00.000Z')

function row(partial: Partial<HygieneRow> & Pick<HygieneRow, 'id'>): HygieneRow {
  return {
    processPath: '/Applications/Cursor-3.1.15.app/Contents/MacOS/Cursor',
    process: 'Cursor Helper',
    host: 'api2.cursor.sh',
    startMs: NOW - HUNG_CONNECTION_MIN_AGE_MS - 5_000,
    uploadSpeed: 0,
    downloadSpeed: 0,
    ...partial
  }
}

describe('cursorTransportHealthCore', () => {
  it('detects critical Cursor transport hosts', () => {
    assert.equal(isCriticalCursorHost('api2.cursor.sh'), true)
    assert.equal(isCriticalCursorHost('agent.api5.cursor.sh'), true)
    assert.equal(isCriticalCursorHost('marketplace.cursorapi.com'), false)
  })

  it('detects hung api2 connections without touching active SSE', () => {
    const hung = row({ id: 'hung' })
    const active = row({ id: 'active', startMs: NOW - 30_000, downloadSpeed: 900 })
    assert.equal(isHungCursorConnection(hung, NOW), true)
    assert.equal(isHungCursorConnection(active, NOW), false)
    assert.deepEqual(selectHungCursorConnectionsToClose([hung, active], NOW), ['hung'])
  })

  it('forces real probe when tun latched or hung connections exist', () => {
    assert.equal(
      shouldForceMandatoryRealProbe({
        cursorConnectionCount: 25,
        lastRealProbeAtMs: NOW - 5_000,
        hungConnectionCount: 1,
        tunInterfaceLostLatched: false,
        burstProbeActive: false,
        nowMs: NOW
      }),
      true
    )
    assert.equal(
      shouldDeferProbeForCursorLoad(25, {
        cursorConnectionCount: 25,
        lastRealProbeAtMs: NOW - 5_000,
        hungConnectionCount: 0,
        tunInterfaceLostLatched: false,
        burstProbeActive: false,
        nowMs: NOW
      }),
      true
    )
    assert.equal(
      shouldDeferProbeForCursorLoad(25, {
        cursorConnectionCount: 25,
        lastRealProbeAtMs: NOW - 35_000,
        hungConnectionCount: 0,
        tunInterfaceLostLatched: false,
        burstProbeActive: false,
        nowMs: NOW
      }),
      false
    )
  })

  it('resolves split-brain transport partition stale', () => {
    assert.equal(
      resolveProbeAttribution({
        api2Ok: false,
        marketplaceOk: true,
        api2LatencyMs: 77_000,
        marketplaceLatencyMs: 515
      }),
      'transport_partition_stale'
    )
    assert.equal(
      shouldExcludeProbeSampleFromNodeScoring('transport_partition_stale'),
      true
    )
    assert.equal(shouldExcludeProbeSampleFromNodeScoring('node_degraded'), false)
  })

  it('defers destructive recovery only after live probe success on same node', () => {
    assert.equal(shouldDeferDestructiveRecoveryAfterLiveProbe(false, 'KR-VPS-TUIC'), false)
    assert.equal(shouldDeferDestructiveRecoveryAfterLiveProbe(true, 'KR-VPS-TUIC', 'KR-VPS-TUIC'), true)
    assert.equal(shouldDeferDestructiveRecoveryAfterLiveProbe(true, 'KR-VPS-TUIC', 'SG-VPS'), false)
  })

  it('escalates recovery ladder for transport partition stale', () => {
    const cooldowns = { lastL0AtMs: 0, lastL1AtMs: 0, lastL2AtMs: 0, lastL3AtMs: 0 }
    assert.equal(
      decideRecoveryAction({
        probe: {
          api2Ok: false,
          marketplaceOk: true,
          api2LatencyMs: 77_000,
          marketplaceLatencyMs: 515
        },
        attribution: 'transport_partition_stale',
        hungConnectionIds: [],
        tunInterfaceLostConfirmed: false,
        priorRecoveryFailed: false,
        cooldowns,
        nowMs: NOW
      }),
      'L1'
    )
    assert.equal(
      decideRecoveryAction({
        probe: {
          api2Ok: false,
          marketplaceOk: true,
          api2LatencyMs: 77_000,
          marketplaceLatencyMs: 515
        },
        attribution: 'transport_partition_stale',
        hungConnectionIds: ['conn-1'],
        tunInterfaceLostConfirmed: false,
        priorRecoveryFailed: false,
        cooldowns,
        nowMs: NOW
      }),
      'L0'
    )
  })

  it('applies independent recovery cooldowns', () => {
    const cooldowns = {
      lastL0AtMs: NOW - 5_000,
      lastL1AtMs: NOW - 5_000,
      lastL2AtMs: NOW - 5_000,
      lastL3AtMs: NOW - 5_000
    }
    assert.equal(canExecuteRecoveryLevel('L0', cooldowns, NOW), false)
    assert.equal(canExecuteRecoveryLevel('L3', cooldowns, NOW), false)
  })

  it('describeRecoveryBlockReason reports L0 cooldown when hung but throttled', () => {
    const reason = describeRecoveryBlockReason({
      probe: { api2Ok: false, marketplaceOk: true, api2LatencyMs: 77_000, marketplaceLatencyMs: 400 },
      attribution: 'transport_partition_stale',
      hungConnectionIds: ['conn-1'],
      tunInterfaceLostConfirmed: false,
      priorRecoveryFailed: false,
      cooldowns: {
        lastL0AtMs: NOW - 5_000,
        lastL1AtMs: 0,
        lastL2AtMs: 0,
        lastL3AtMs: 0
      },
      nowMs: NOW
    })
    assert.equal(reason, 'L0_cooldown')
  })
})
