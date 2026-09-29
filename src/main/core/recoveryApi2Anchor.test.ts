// [INPUT] recoveryApi2Anchor
// [OUTPUT] recoveryApi2Anchor.test
// [POS] BUG-2026-09-03-012 — Cursor dedicated api2 anchor probe contract.

import assert from 'node:assert/strict'
import { describe, it, afterEach } from 'node:test'
import {
  probeRecoveryApi2Anchor,
  probeRecoveryApi2AnchorDetailed,
  resetRecoveryApi2AnchorForTests,
  setRecoveryApi2AnchorOverrideForTests,
} from './recoveryApi2Anchor'

describe('recoveryApi2Anchor', () => {
  afterEach(() => {
    resetRecoveryApi2AnchorForTests()
  })

  it('probeRecoveryApi2Anchor returns ok from override', async () => {
    setRecoveryApi2AnchorOverrideForTests(async () => ({
      ok: true,
      leaf: 'KR-VPS-HY2',
      latencyMs: 320,
      probeVia: 'cursor_dedicated_mihomo',
    }))
    assert.equal(await probeRecoveryApi2Anchor(), true)
    const detailed = await probeRecoveryApi2AnchorDetailed()
    assert.equal(detailed.leaf, 'KR-VPS-HY2')
    assert.equal(detailed.probeVia, 'cursor_dedicated_mihomo')
  })

  it('probeRecoveryApi2Anchor returns false when cursor dedicated leaf fails', async () => {
    setRecoveryApi2AnchorOverrideForTests(async () => ({
      ok: false,
      leaf: 'KR-VPS-HY2',
      latencyMs: 5001,
      errorDetail: 'timeout',
      probeVia: 'cursor_dedicated_mihomo',
    }))
    assert.equal(await probeRecoveryApi2Anchor(), false)
  })
})
