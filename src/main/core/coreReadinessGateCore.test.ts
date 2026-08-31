import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertNoInvalidJsRegexPcreInBundle,
  findInvalidJsRegexPcrePatterns,
  formatCoreReadinessPhaseLog,
  shouldRetryProfileCheck,
} from './coreReadinessGateCore'

describe('coreReadinessGateCore', () => {
  it('shouldRetryProfileCheck for transient provider gaps', () => {
    assert.equal(shouldRetryProfileCheck("proxy group: '🇺🇸 美国 02' not found"), true)
    assert.equal(shouldRetryProfileCheck('Profile Check Failed:\n msg=timeout'), false)
  })

  it('formatCoreReadinessPhaseLog is stable', () => {
    assert.equal(
      formatCoreReadinessPhaseLog('sidecar', 'reachable'),
      '[CoreReadiness]: phase=sidecar outcome=reachable\n',
    )
  })

  it('findInvalidJsRegexPcrePatterns catches (?i) in JS literals', () => {
    const hits = findInvalidJsRegexPcrePatterns('return /(?i)-VPS-HY2$/.test(trimmed);')
    assert.deepEqual(hits, ['/(?i)'])
  })

  it('assertNoInvalidJsRegexPcreInBundle passes valid /i suffix', () => {
    assert.doesNotThrow(() =>
      assertNoInvalidJsRegexPcreInBundle('return /-VPS-HY2$/i.test(trimmed);'),
    )
  })

  it('assertNoInvalidJsRegexPcreInBundle rejects invalid bundle', () => {
    assert.throws(
      () => assertNoInvalidJsRegexPcreInBundle('return /(?i)-VPS-HY2$/.test(trimmed);'),
      /invalid JS regex PCRE flags/,
    )
  })
})
