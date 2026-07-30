import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MTDO_COALESCE_MS,
  MTDO_OBSERVABILITY_BUNDLE_MS,
  MTDO_CONNECT_PATH_PULSE_INTERVAL_MS,
  selectMarathonTransportDialTrigger,
  shouldCoalesceMarathonTransportDial,
  shouldRunIndependentConnectPathPulse,
} from './marathonTransportDialOrchestratorCore'
import { CURSOR_HY2_MARATHON_CONN_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'

describe('marathonTransportDialOrchestratorCore', () => {
  it('prioritizes silent_generation_end over token_gap', () => {
    const nowMs = 10_000_000
    const candidate = selectMarathonTransportDialTrigger({
      nowMs,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      lastDialAtMs: 0,
      lastConnectPathPulseAtMs: 0,
      latencyDeltaHigh: false,
      latencyDeltaRescueEligible: false,
      silentGenerationEnd: {
        maxGapMs: 7622,
        staleRequestIds: ['rid-a'],
        lookbackMs: 120_000,
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
        suddenSilentGenerationEnd: true,
      },
      tokenGap: {
        maxGapMs: 25_000,
        staleRequestIds: ['rid-a'],
        lookbackMs: 180_000,
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      },
      connectPathPartitionDetected: false,
      tokenGapSuppressedPendingTool: false,
      marathonStreamActive: true,
      marathonTruthPulseDue: true,
      forceHighLatencyWarmth: false,
    })
    assert.equal(candidate?.trigger, 'silent_generation_end')
  })

  it('coalesces warmth but not rescue within 15s', () => {
    const nowMs = 10_000_000
    const base = {
      nowMs,
      cursorConnectionCount: 80,
      lastDialAtMs: nowMs - MTDO_OBSERVABILITY_BUNDLE_MS + 1,
      lastConnectPathPulseAtMs: 0,
      latencyDeltaHigh: false,
      latencyDeltaRescueEligible: false,
      connectPathPartitionDetected: false,
      tokenGapSuppressedPendingTool: false,
      marathonStreamActive: true,
      marathonTruthPulseDue: true,
      forceHighLatencyWarmth: false,
    }
    assert.equal(
      shouldCoalesceMarathonTransportDial(base, {
        trigger: 'periodic_session',
        plan: 'session_warmth_bundle',
      }),
      true,
    )
    assert.equal(
      shouldCoalesceMarathonTransportDial(base, {
        trigger: 'silent_generation_end',
        plan: 'connect_rescue_bundle',
      }),
      false,
    )
  })

  it('prioritizes connect_path_partition when last pulse detected split-brain', () => {
    const nowMs = 10_000_000
    const candidate = selectMarathonTransportDialTrigger({
      nowMs,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      lastDialAtMs: 0,
      lastConnectPathPulseAtMs: nowMs - 5_000,
      latencyDeltaHigh: false,
      latencyDeltaRescueEligible: false,
      tokenGap: {
        maxGapMs: 25_000,
        staleRequestIds: ['rid-a'],
        lookbackMs: 180_000,
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      },
      connectPathPartitionDetected: true,
      tokenGapSuppressedPendingTool: false,
      marathonStreamActive: true,
      marathonTruthPulseDue: true,
      forceHighLatencyWarmth: false,
    })
    assert.equal(candidate?.trigger, 'connect_path_partition')
  })

  it('P24: skips independent pulse when marathonTruthPulseDue is false', () => {
    const nowMs = 10_000_000
    assert.equal(
      shouldRunIndependentConnectPathPulse({
        nowMs,
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
        lastDialAtMs: 0,
        lastConnectPathPulseAtMs: nowMs - MTDO_CONNECT_PATH_PULSE_INTERVAL_MS,
        latencyDeltaHigh: false,
        latencyDeltaRescueEligible: false,
        connectPathPartitionDetected: false,
        tokenGapSuppressedPendingTool: false,
        marathonStreamActive: true,
        marathonTruthPulseDue: false,
        forceHighLatencyWarmth: false,
      }),
      false,
    )
  })

  it('runs independent connect path pulse every 60s when marathon stream active', () => {
    const nowMs = 10_000_000
    assert.equal(
      shouldRunIndependentConnectPathPulse({
        nowMs,
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
        lastDialAtMs: 0,
        lastConnectPathPulseAtMs: nowMs - MTDO_CONNECT_PATH_PULSE_INTERVAL_MS,
        latencyDeltaHigh: false,
      latencyDeltaRescueEligible: false,
        connectPathPartitionDetected: false,
        tokenGapSuppressedPendingTool: false,
        marathonStreamActive: true,
      marathonTruthPulseDue: true,
        forceHighLatencyWarmth: false,
      }),
      true,
    )
  })

  it('independent pulse does not require token_gap silence', () => {
    const nowMs = 10_000_000
    assert.equal(
      shouldRunIndependentConnectPathPulse({
        nowMs,
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
        lastDialAtMs: 0,
        lastConnectPathPulseAtMs: nowMs - MTDO_CONNECT_PATH_PULSE_INTERVAL_MS,
        latencyDeltaHigh: false,
      latencyDeltaRescueEligible: false,
        tokenGap: {
          maxGapMs: 25_000,
          staleRequestIds: ['rid-a'],
          lookbackMs: 180_000,
          cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
        },
        connectPathPartitionDetected: false,
        tokenGapSuppressedPendingTool: false,
        marathonStreamActive: true,
      marathonTruthPulseDue: true,
        forceHighLatencyWarmth: false,
      }),
      true,
    )
  })

  it('prioritizes connect_partition over latency_delta_rescue', () => {
    const nowMs = 10_000_000
    const candidate = selectMarathonTransportDialTrigger({
      nowMs,
      cursorConnectionCount: 816,
      lastDialAtMs: 0,
      lastConnectPathPulseAtMs: 0,
      latencyDeltaHigh: true,
      latencyDeltaRescueEligible: true,
      connectPartition: {
        pingFailureCount: 2,
        windowMs: 8_000,
        cursorConnectionCount: 816,
        sampleRequestIds: ['rid-a'],
      },
      connectPathPartitionDetected: false,
      tokenGapSuppressedPendingTool: false,
      marathonStreamActive: true,
      marathonTruthPulseDue: true,
      forceHighLatencyWarmth: false,
    })
    assert.equal(candidate?.trigger, 'connect_partition')
  })

  it('selects latency_delta_rescue when eligible and no higher rescue', () => {
    const nowMs = 10_000_000
    const candidate = selectMarathonTransportDialTrigger({
      nowMs,
      cursorConnectionCount: 816,
      lastDialAtMs: 0,
      lastConnectPathPulseAtMs: 0,
      latencyDeltaHigh: true,
      latencyDeltaRescueEligible: true,
      connectPathPartitionDetected: false,
      tokenGapSuppressedPendingTool: false,
      marathonStreamActive: true,
      marathonTruthPulseDue: true,
      forceHighLatencyWarmth: false,
    })
    assert.equal(candidate?.trigger, 'latency_delta_rescue')
  })

  it('does not select marathon_connect_path_pulse via trigger priority (P15 independent)', () => {
    const nowMs = 10_000_000
    const candidate = selectMarathonTransportDialTrigger({
      nowMs,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      lastDialAtMs: 0,
      lastConnectPathPulseAtMs: nowMs - MTDO_CONNECT_PATH_PULSE_INTERVAL_MS,
      latencyDeltaHigh: false,
      latencyDeltaRescueEligible: false,
      connectPathPartitionDetected: false,
      tokenGapSuppressedPendingTool: false,
      marathonStreamActive: true,
      marathonTruthPulseDue: true,
      forceHighLatencyWarmth: false,
    })
    assert.notEqual(candidate?.trigger, 'marathon_connect_path_pulse')
  })
})
