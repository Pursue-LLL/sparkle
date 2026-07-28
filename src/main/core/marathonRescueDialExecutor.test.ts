import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { executeMarathonRescueDial } from './marathonRescueDialExecutor'
import {
  resetMarathonSessionDialExecutorStateForTests,
  setHy2SessionNudgeDialPairOverrideForTests,
  setSkipMarathonSessionDialAppLogForTests,
} from './marathonSessionDialExecutorCore'
import {
  resetCursorDedicatedNodeResolverStateForTests,
  setCursorDedicatedActiveNodeOverrideForTests,
} from './cursorDedicatedNodeResolver'

describe('marathonRescueDialExecutor behavioral', () => {
  it('connect_partition rescue returns executed (G10 gate #1)', async () => {
    resetMarathonSessionDialExecutorStateForTests()
    resetCursorDedicatedNodeResolverStateForTests()
    setSkipMarathonSessionDialAppLogForTests(true)
    setCursorDedicatedActiveNodeOverrideForTests('JP-VPS-HY2')
    setHy2SessionNudgeDialPairOverrideForTests(async () => ({
      api2Result: { delay: 320 },
      api2geoResult: { delay: 310 },
    }))

    const result = await executeMarathonRescueDial(30, {
      trigger: 'connect_partition',
      nowMs: Date.now(),
    })
    assert.equal(result.outcome, 'executed')
    assert.equal(result.api2DelayMs, 320)
  })

  it('connect_partition rescue returns executed when probe delay is 0 (G22 weak_probe)', async () => {
    resetMarathonSessionDialExecutorStateForTests()
    resetCursorDedicatedNodeResolverStateForTests()
    setSkipMarathonSessionDialAppLogForTests(true)
    setCursorDedicatedActiveNodeOverrideForTests('JP-VPS-HY2')
    setHy2SessionNudgeDialPairOverrideForTests(async () => ({
      api2Result: { delay: 0, message: 'timeout' },
      api2geoResult: { delay: 0 },
    }))

    const result = await executeMarathonRescueDial(290, {
      trigger: 'connect_partition',
      nowMs: Date.now(),
    })
    assert.equal(result.outcome, 'executed')
    assert.equal(result.api2DelayMs, 0)
  })
})
