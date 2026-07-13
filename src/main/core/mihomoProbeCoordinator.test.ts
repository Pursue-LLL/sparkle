import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  COMMERCIAL_PROBE_MAX_CONCURRENCY,
  getActiveMihomoDelayProbes,
  MIHOMO_DELAY_PROBE_MAX_CONCURRENT,
  resolveCommercialProbeConcurrency,
  resetMihomoDelayProbeCoordinatorForTests,
  withMihomoDelayProbeSlot
} from './mihomoProbeCoordinator'

describe('mihomoProbeCoordinator', () => {
  it('clamps commercial concurrency to safe max', () => {
    assert.equal(resolveCommercialProbeConcurrency(undefined), COMMERCIAL_PROBE_MAX_CONCURRENCY)
    assert.equal(resolveCommercialProbeConcurrency(10), COMMERCIAL_PROBE_MAX_CONCURRENCY)
    assert.equal(resolveCommercialProbeConcurrency(2), 2)
    assert.equal(resolveCommercialProbeConcurrency(0), 1)
  })

  it('limits global mihomo delay probes', async () => {
    resetMihomoDelayProbeCoordinatorForTests()
    let peak = 0
    const tasks = Array.from({ length: 4 }, () =>
      withMihomoDelayProbeSlot(async () => {
        peak = Math.max(peak, getActiveMihomoDelayProbes())
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
    )
    await Promise.all(tasks)
    assert.equal(peak, MIHOMO_DELAY_PROBE_MAX_CONCURRENT)
    assert.equal(getActiveMihomoDelayProbes(), 0)
  })
})
