import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatSparkleBuildStamp } from './writeBuildStampCore'

describe('formatSparkleBuildStamp', () => {
  it('formats YYYY.MMDD.HHMM in local time', () => {
    const stamp = formatSparkleBuildStamp(new Date(2026, 6, 27, 18, 52))
    assert.equal(stamp, '2026.0727.1852')
  })
})
