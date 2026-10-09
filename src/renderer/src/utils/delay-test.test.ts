import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_DELAY_TEST_CONCURRENCY,
  MAX_DELAY_TEST_CONCURRENCY,
  MIN_DELAY_TEST_CONCURRENCY,
  normalizeDelayTestConcurrency
} from './delay-test'

describe('delay-test concurrency', () => {
  it('defaults to template-aligned concurrency when unset', () => {
    assert.equal(normalizeDelayTestConcurrency(undefined), DEFAULT_DELAY_TEST_CONCURRENCY)
    assert.equal(DEFAULT_DELAY_TEST_CONCURRENCY, 3)
  })

  it('clamps to the supported range', () => {
    assert.equal(normalizeDelayTestConcurrency(0), MIN_DELAY_TEST_CONCURRENCY)
    assert.equal(normalizeDelayTestConcurrency(9999), MAX_DELAY_TEST_CONCURRENCY)
    assert.equal(normalizeDelayTestConcurrency(7.9), 7)
  })
})
