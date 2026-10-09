import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getActiveMihomoDelayProbes,
  MIHOMO_DELAY_PROBE_MAX_CONCURRENT,
  resetMihomoDelayProbeCoordinatorForTests,
  withMihomoDelayProbeSlot
} from './mihomoProbeCoordinator'

describe('mihomoProbeCoordinator', () => {
  it('limits global mihomo delay probes', async () => {
    resetMihomoDelayProbeCoordinatorForTests()
    let peak = 0
    const tasks = Array.from({ length: 4 }, () =>
      withMihomoDelayProbeSlot(async () => {
        peak = Math.max(peak, getActiveMihomoDelayProbes())
        await new Promise((resolve) => {
          setTimeout(resolve, 30)
        })
      })
    )
    await Promise.all(tasks)
    assert.equal(peak, MIHOMO_DELAY_PROBE_MAX_CONCURRENT)
    assert.equal(getActiveMihomoDelayProbes(), 0)
  })
})
