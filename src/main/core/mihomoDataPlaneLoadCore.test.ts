import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isMihomoDataPlaneBusy,
  resolveMihomoDelayProbeMaxConcurrent,
} from './mihomoDataPlaneLoadCore'
import { getCachedMihomoActiveConnectionCount, updateCachedMihomoActiveConnectionCount } from './mihomoDataPlaneLoadState'
import { isMihomoDelayProbeCongested, resetMihomoDelayProbeCoordinatorForTests } from './mihomoProbeCoordinator'

describe('mihomoDataPlaneLoadCore', () => {
  it('marks data plane busy at threshold', () => {
    assert.equal(isMihomoDataPlaneBusy(47), false)
    assert.equal(isMihomoDataPlaneBusy(48), true)
  })

  it('reduces probe concurrency when busy', () => {
    assert.equal(resolveMihomoDelayProbeMaxConcurrent(10), 2)
    assert.equal(resolveMihomoDelayProbeMaxConcurrent(60), 1)
  })
})

describe('mihomoProbeCoordinator load gate', () => {
  it('congests earlier when cached active connections are high', () => {
    resetMihomoDelayProbeCoordinatorForTests()
    updateCachedMihomoActiveConnectionCount(60)
    assert.equal(getCachedMihomoActiveConnectionCount(), 60)
    assert.equal(isMihomoDelayProbeCongested(), false)
  })
})
