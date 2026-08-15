import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  nextLogFileSizeAfterAppend,
  resolveCachedLogFileSize,
  shouldTrimLogFile,
  trimTargetBytes,
} from './logFileSizeCore'

describe('logFileSizeCore', () => {
  it('uses cached size for same path', () => {
    assert.equal(resolveCachedLogFileSize({ path: '/tmp/a.log', size: 42 }, '/tmp/a.log'), 42)
    assert.equal(resolveCachedLogFileSize({ path: '/tmp/a.log', size: 42 }, '/tmp/b.log'), null)
  })

  it('computes append and trim thresholds', () => {
    assert.equal(nextLogFileSizeAfterAppend(100, 5), 105)
    assert.equal(shouldTrimLogFile(105, 100), true)
    assert.equal(trimTargetBytes(100, 0.7), 70)
  })
})
