import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MIN_RANK_SAMPLES } from './nodeProbeStats'

/** Mirrors commercialNodeBenchmark.buildStabilitySnapshot VPS-only policy for regression tests. */
function buildVpsOnlyScoresByNode(
  derived: Array<{ stats: { node: string; kind: string; samples: number } }>
): Record<string, string> {
  const scoresByNode: Record<string, string> = {}
  for (const entry of derived) {
    if (entry.stats.kind !== 'vps') continue
    if (entry.stats.samples < MIN_RANK_SAMPLES) continue
    scoresByNode[entry.stats.node] = entry.stats.kind
  }
  return scoresByNode
}

describe('commercial node stability snapshot', () => {
  it('scoresByNode ignores commercial samples', () => {
    const derived = [
      { stats: { node: 'KR-VPS-HY2', kind: 'vps', samples: MIN_RANK_SAMPLES } },
      { stats: { node: '🇯🇵 日本 I1', kind: 'commercial', samples: MIN_RANK_SAMPLES + 5 } }
    ]
    const scores = buildVpsOnlyScoresByNode(derived)
    assert.deepEqual(Object.keys(scores), ['KR-VPS-HY2'])
    assert.equal(scores['KR-VPS-HY2'], 'vps')
    assert.equal(scores['🇯🇵 日本 I1'], undefined)
  })
})
