import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveCursorStability } from './cursorNodeStability'
import { MIN_RANK_SAMPLES } from './nodeQualityScore'

describe('cursorNodeStability', () => {
  it('marks low-sample nodes as unknown', () => {
    const view = deriveCursorStability({
      samples: MIN_RANK_SAMPLES - 1,
      successRate: 1,
      jitter: 20,
      slow500Rate: 0,
      eligibleForBadge: true,
      transportFailures: 0
    })
    assert.equal(view.level, 'unknown')
  })

  it('marks agent RST as risk', () => {
    const rst = deriveCursorStability({
      samples: 20,
      successRate: 0.99,
      jitter: 40,
      slow500Rate: 0.01,
      eligibleForBadge: true,
      transportFailures: 3
    })
    assert.equal(rst.level, 'risk')
  })

  it('marks badge-eligible clean nodes as excellent', () => {
    const view = deriveCursorStability({
      samples: 20,
      successRate: 0.99,
      jitter: 80,
      slow500Rate: 0.02,
      eligibleForBadge: true,
      transportFailures: 0
    })
    assert.equal(view.level, 'excellent')
    assert.equal(view.label, '极佳')
  })
})
