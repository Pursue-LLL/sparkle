import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MTDO_MARATHON_STREAM_MIN_AGE_MS } from './marathonTransportDialOrchestratorCore'
import {
  resetHy2TunnelVitalityStateForTests,
  runHy2TunnelVitalityIfDue,
  setHy2TunnelVitalityDialOverrideForTests,
  setSkipHy2TunnelVitalityAppLogForTests,
} from './hy2TunnelVitality'
import {
  releaseHy2SessionDialInFlight,
  resetMarathonSessionDialExecutorStateForTests,
  tryAcquireHy2SessionDialInFlight,
} from './marathonSessionDialExecutorCore'

describe('hy2TunnelVitality executor', () => {
  it('executes connect_path dial when gate open', async () => {
    resetHy2TunnelVitalityStateForTests()
    resetMarathonSessionDialExecutorStateForTests()
    setSkipHy2TunnelVitalityAppLogForTests(true)
    setHy2TunnelVitalityDialOverrideForTests(async () => ({ delay: 288 }))
    const nowMs = 60_000_000
    const result = await runHy2TunnelVitalityIfDue('JP-VPS-HY2', 25, nowMs, {
      marathonTruthActive: true,
      pulseContractDue: true,
      openSegmentCount: 1,
      maxParentChainAgeMs: MTDO_MARATHON_STREAM_MIN_AGE_MS + 5_000,
      parentChains: [],
    })
    assert.equal(result.outcome, 'executed')
    assert.equal(result.connectPathDelayMs, 288)
  })

  it('defers when HY2 session nudge dial is in flight', async () => {
    resetHy2TunnelVitalityStateForTests()
    resetMarathonSessionDialExecutorStateForTests()
    setSkipHy2TunnelVitalityAppLogForTests(true)
    assert.equal(tryAcquireHy2SessionDialInFlight(), true)
    try {
      const result = await runHy2TunnelVitalityIfDue('JP-VPS-HY2', 25, 70_000_000, {
        marathonTruthActive: true,
        pulseContractDue: true,
        openSegmentCount: 1,
        maxParentChainAgeMs: MTDO_MARATHON_STREAM_MIN_AGE_MS + 5_000,
        parentChains: [],
      })
      assert.equal(result.outcome, 'skipped_in_flight')
    } finally {
      releaseHy2SessionDialInFlight()
    }
  })
})
