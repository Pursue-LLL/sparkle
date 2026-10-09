import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickLatestSuccessfulProviderDelay } from './mihomoProviderDelayCore'

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
})
