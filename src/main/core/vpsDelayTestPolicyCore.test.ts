import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_DELAY_TEST_TIMEOUT_MS,
  evaluateUiVpsDelayWaitStep,
  isVpsCursorLeafBatch,
  resolveVpsDelayTestTimeoutMs,
  shouldDeferUiVpsDelayTest,
  VPS_DELAY_TEST_TIMEOUT_MS,
  VPS_UI_DELAY_DEFER_CONN_THRESHOLD
} from './vpsDelayTestPolicyCore'

describe('vpsDelayTestPolicyCore', () => {
  it('detects VPS leaf batches', () => {
    assert.equal(isVpsCursorLeafBatch(['JP-VPS-HY2', 'KR-VPS-TUIC']), true)
    assert.equal(isVpsCursorLeafBatch(['JP-VPS-HY2', 'SG-01']), false)
  })

  it('defers ui batch delay under cursor marathon load or burst', () => {
    assert.equal(
      shouldDeferUiVpsDelayTest({
        cursorConnectionCount: VPS_UI_DELAY_DEFER_CONN_THRESHOLD,
        burstActive: false,
        delayProbeCongested: false,
        shortProbeActive: false
      }),
      true
    )
    assert.equal(
      shouldDeferUiVpsDelayTest({
        cursorConnectionCount: 0,
        burstActive: true,
        delayProbeCongested: false,
        shortProbeActive: false
      }),
      true
    )
  })

  it('aligns delay timeout with marathon dial-timeout', () => {
    assert.equal(
      resolveVpsDelayTestTimeoutMs(undefined, 45),
      VPS_DELAY_TEST_TIMEOUT_MS
    )
    assert.equal(
      resolveVpsDelayTestTimeoutMs(DEFAULT_DELAY_TEST_TIMEOUT_MS, 5),
      DEFAULT_DELAY_TEST_TIMEOUT_MS
    )
  })

  it('fail-closes when wait budget exhausted under cursor load', () => {
    const startedAt = Date.now() - 120_001
    assert.equal(
      evaluateUiVpsDelayWaitStep(startedAt, {
        cursorConnectionCount: VPS_UI_DELAY_DEFER_CONN_THRESHOLD,
        burstActive: false,
        delayProbeCongested: false,
        shortProbeActive: false
      }),
      'slot_busy'
    )
  })

  it('allows probing when slot is free', () => {
    assert.equal(
      evaluateUiVpsDelayWaitStep(Date.now(), {
        cursorConnectionCount: 0,
        burstActive: false,
        delayProbeCongested: false,
        shortProbeActive: false
      }),
      'ready'
    )
  })
})
