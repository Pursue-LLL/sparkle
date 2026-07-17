import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  pickFreshSuccessfulProviderDelay,
  pickLatestSuccessfulProviderDelay,
  PROVIDER_DELAY_CACHE_TTL_MS
} from './mihomoProviderDelayCore'

describe('mihomo provider delay history', () => {
  it('skips trailing timeout samples and returns the latest successful delay', () => {
    const picked = pickLatestSuccessfulProviderDelay([
      { time: '2026-07-14T07:00:00.000Z', delay: 320 },
      { time: '2026-07-14T07:05:00.000Z', delay: 0 },
      { time: '2026-07-14T07:10:00.000Z', delay: 0 }
    ])
    assert.equal(picked?.delay, 320)
  })

  it('returns undefined when no successful sample exists', () => {
    const picked = pickLatestSuccessfulProviderDelay([
      { time: '2026-07-14T07:05:00.000Z', delay: 0 }
    ])
    assert.equal(picked, undefined)
  })

  it('returns fresh successful delay within TTL', () => {
    const nowMs = Date.parse('2026-07-14T07:02:00.000Z')
    const picked = pickFreshSuccessfulProviderDelay(
      [{ time: '2026-07-14T07:01:00.000Z', delay: 280 }],
      nowMs,
      PROVIDER_DELAY_CACHE_TTL_MS
    )
    assert.equal(picked?.delay, 280)
  })

  it('returns undefined when successful delay is older than TTL', () => {
    const nowMs = Date.parse('2026-07-14T07:05:00.000Z')
    const picked = pickFreshSuccessfulProviderDelay(
      [{ time: '2026-07-14T07:01:00.000Z', delay: 280 }],
      nowMs,
      PROVIDER_DELAY_CACHE_TTL_MS
    )
    assert.equal(picked, undefined)
  })
})
