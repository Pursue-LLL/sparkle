import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertSparkleMainAsarBundle,
  validateSparkleMainAsarBundle,
} from './upgradeSparkleAsarGateCore'

const VALID_BUNDLE = 'appendAppLog .markCoreReadyAtMs( [CoreReadiness]: runCoreReadinessPipeline'

describe('upgradeSparkleAsarGateCore', () => {
  it('accepts a bundle with linked markCoreReadyAtMs call and readiness gate', () => {
    assert.deepEqual(validateSparkleMainAsarBundle(VALID_BUNDLE), { ok: true })
    assert.doesNotThrow(() => assertSparkleMainAsarBundle(VALID_BUNDLE))
  })

  it('rejects bare markCoreReadyAtMs() without chunk prefix (BUG-2026-07-23-004 regression)', () => {
    const result = validateSparkleMainAsarBundle('require_log.appendAppLog("x"); markCoreReadyAtMs();')
    assert.deepEqual(result, { ok: false, reason: 'missing_mark_core_ready_call' })
  })

  it('rejects stale bundle missing appendAppLog', () => {
    const result = validateSparkleMainAsarBundle('.markCoreReadyAtMs( [CoreReadiness]:')
    assert.deepEqual(result, { ok: false, reason: 'stale_bundle' })
  })

  it('rejects invalid JS regex PCRE inline flags', () => {
    const result = validateSparkleMainAsarBundle(`${VALID_BUNDLE} return /(?i)-VPS-HY2$/.test(x)`)
    assert.deepEqual(result, { ok: false, reason: 'invalid_js_regex_pcre' })
  })

  it('rejects bundle missing Core Readiness gate', () => {
    const result = validateSparkleMainAsarBundle('appendAppLog .markCoreReadyAtMs(')
    assert.deepEqual(result, { ok: false, reason: 'missing_core_readiness_gate' })
    assert.throws(() => assertSparkleMainAsarBundle('appendAppLog .markCoreReadyAtMs('), /Core Readiness/)
  })
})
