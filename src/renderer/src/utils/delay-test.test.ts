import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_DELAY_TEST_CONCURRENCY,
  isVpsCursorLeafNode,
  normalizeDelayTestConcurrency,
  resolveDelayTestConcurrencyForProxies,
  VPS_DELAY_TEST_CONCURRENCY
} from './delay-test'

describe('delay-test concurrency', () => {
  it('defaults to template-aligned concurrency when unset', () => {
    assert.equal(normalizeDelayTestConcurrency(undefined), DEFAULT_DELAY_TEST_CONCURRENCY)
    assert.equal(DEFAULT_DELAY_TEST_CONCURRENCY, 3)
  })

  it('detects VPS cursor leaf nodes', () => {
    assert.equal(isVpsCursorLeafNode('JP-VPS-HY2'), true)
    assert.equal(isVpsCursorLeafNode('KR-VPS-Reality'), true)
    assert.equal(isVpsCursorLeafNode('新加坡-01'), false)
  })

  it('serializes VPS leaf batch delay tests', () => {
    assert.equal(
      resolveDelayTestConcurrencyForProxies(
        ['JP-VPS-HY2', 'KR-VPS-TUIC', 'JP-VPS-TLS'],
        50
      ),
      VPS_DELAY_TEST_CONCURRENCY
    )
    assert.equal(
      resolveDelayTestConcurrencyForProxies(['新加坡-01', '日本-02'], 50),
      50
    )
  })
})
