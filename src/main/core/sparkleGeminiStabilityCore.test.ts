import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canRecordPenalty,
  isNodeStable,
  parseStabilityLedger,
  PENALTY_BURST_LIMIT,
  PENALTY_BURST_WINDOW_MS,
  recordSample,
  STABLE_CLEAN_WINDOW_MS,
  STABLE_MIN_SAMPLES
} from './sparkleGeminiStabilityCore'

const NOW = 1_700_000_000_000

describe('sparkleGeminiStabilityCore isNodeStable', () => {
  it('does not trust a node nobody has judged', () => {
    assert.equal(isNodeStable(undefined, NOW), false)
  })

  it('needs enough clear verdicts before it trusts a node', () => {
    assert.equal(isNodeStable({ samples: STABLE_MIN_SAMPLES - 1 }, NOW), false)
    assert.equal(isNodeStable({ samples: STABLE_MIN_SAMPLES }, NOW), true)
  })

  it('stops trusting a node for the whole clean window after it was judged blocked', () => {
    const entry = { samples: STABLE_MIN_SAMPLES * 3, lastBadAt: NOW - STABLE_CLEAN_WINDOW_MS + 1 }

    assert.equal(isNodeStable(entry, NOW), false)
    assert.equal(isNodeStable({ ...entry, lastBadAt: NOW - STABLE_CLEAN_WINDOW_MS }, NOW), true)
  })

  it('keeps distrusting a node whose last block lies in the future of this clock', () => {
    assert.equal(isNodeStable({ samples: 99, lastBadAt: NOW + 1000 }, NOW), false)
  })
})

describe('sparkleGeminiStabilityCore recordSample', () => {
  it('starts counting from the first verdict', () => {
    assert.deepEqual(recordSample(undefined, false, NOW), { samples: 1 })
    assert.deepEqual(recordSample(undefined, true, NOW), { samples: 1, lastBadAt: NOW })
  })

  it('counts every verdict and moves the last-block time only on a block', () => {
    const blocked = recordSample({ samples: 4 }, true, NOW)
    assert.deepEqual(blocked, { samples: 5, lastBadAt: NOW })

    assert.deepEqual(recordSample(blocked, false, NOW + 1000), { samples: 6, lastBadAt: NOW })
    assert.deepEqual(recordSample(blocked, true, NOW + 1000), {
      samples: 6,
      lastBadAt: NOW + 1000
    })
  })

  it('does not change the entry it is given', () => {
    const entry = { samples: 3 }

    recordSample(entry, true, NOW)

    assert.deepEqual(entry, { samples: 3 })
  })
})

describe('sparkleGeminiStabilityCore canRecordPenalty', () => {
  it('accepts penalties until the burst limit is used up inside the window', () => {
    assert.equal(canRecordPenalty([], NOW), true)
    assert.equal(canRecordPenalty(Array(PENALTY_BURST_LIMIT - 1).fill(NOW - 1000), NOW), true)
    assert.equal(canRecordPenalty(Array(PENALTY_BURST_LIMIT).fill(NOW - 1000), NOW), false)
  })

  it('forgets penalties once they are a full window old', () => {
    const old = NOW - PENALTY_BURST_WINDOW_MS
    const inside = NOW - PENALTY_BURST_WINDOW_MS + 1

    assert.equal(canRecordPenalty(Array(PENALTY_BURST_LIMIT).fill(old), NOW), true)
    assert.equal(canRecordPenalty(Array(PENALTY_BURST_LIMIT).fill(inside), NOW), false)
  })
})

describe('sparkleGeminiStabilityCore parseStabilityLedger', () => {
  it('reads well-formed entries, with or without a block time', () => {
    const ledger = parseStabilityLedger(
      { 日本: { samples: 12 }, 台湾: { samples: 3, lastBadAt: NOW - 1000 } },
      NOW
    )

    assert.deepEqual(
      [...ledger],
      [
        ['日本', { samples: 12 }],
        ['台湾', { samples: 3, lastBadAt: NOW - 1000 }]
      ]
    )
  })

  it('starts empty when the content is not an object of entries', () => {
    for (const raw of [null, undefined, 42, 'text', [], [{ samples: 1 }]]) {
      assert.equal(parseStabilityLedger(raw, NOW).size, 0, JSON.stringify(raw))
    }
  })

  it('drops only the entries that are malformed', () => {
    const ledger = parseStabilityLedger(
      {
        good: { samples: 5 },
        noSamples: {},
        negative: { samples: -1 },
        fractional: { samples: 1.5 },
        text: { samples: '5' },
        badTime: { samples: 5, lastBadAt: 'yesterday' },
        zeroTime: { samples: 5, lastBadAt: 0 },
        negativeTime: { samples: 5, lastBadAt: -1 },
        nullTime: { samples: 5, lastBadAt: null },
        nothing: null,
        scalar: 7
      },
      NOW
    )

    assert.deepEqual([...ledger.keys()], ['good'])
  })

  it('counts a block time from the future of this clock as happening now', () => {
    const ledger = parseStabilityLedger(
      { 日本: { samples: 50, lastBadAt: NOW + 3650 * 86_400_000 } },
      NOW
    )

    assert.deepEqual(ledger.get('日本'), { samples: 50, lastBadAt: NOW })
    assert.equal(isNodeStable(ledger.get('日本'), NOW + STABLE_CLEAN_WINDOW_MS), true)
  })
})
