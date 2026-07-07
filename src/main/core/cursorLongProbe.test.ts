import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_LONG_PROBE_TARGET,
  CURSOR_MARATHON_PROBE_HOLD_MS,
  CURSOR_SSE_WELCOME_PREFIX,
  CURSOR_STREAM_PROBE,
  classifyCursorLongProbeOutcome,
  isCursorLongProbeMarathonApplicable,
  isCursorLongStream15mCap,
  isCursorSseWelcomeBanner
} from './cursorMarathonProbe'

describe('cursor long probe', () => {
  it('targets api2 not agent.api5 (plain HTTP SSE path)', () => {
    assert.equal(CURSOR_LONG_PROBE_TARGET, CURSOR_STREAM_PROBE)
    assert.equal(CURSOR_LONG_PROBE_TARGET, 'https://api2.cursor.sh')
    assert.notEqual(CURSOR_LONG_PROBE_TARGET, 'https://agent.api5.cursor.sh')
  })

  it('detects 15min cap window', () => {
    assert.equal(
      isCursorLongStream15mCap({ earlyClose: true, holdMs: 900_000, errorCode: undefined }),
      true
    )
    assert.equal(
      isCursorLongStream15mCap({ earlyClose: true, holdMs: 120_000, errorCode: undefined }),
      false
    )
    assert.equal(CURSOR_MARATHON_PROBE_HOLD_MS, 960_000)
  })

  it('recognizes unauthenticated api2 welcome banner', () => {
    assert.equal(
      isCursorSseWelcomeBanner(`${CURSOR_SSE_WELCOME_PREFIX}. From 20260707-021129-abc`),
      true
    )
    assert.equal(isCursorSseWelcomeBanner('event: ping'), false)
  })

  it('classifies welcome-only close as non-marathon (not proxy fault)', () => {
    const out = classifyCursorLongProbeOutcome({
      earlyClose: true,
      holdMs: 961,
      status: 200,
      ssePrefix: `${CURSOR_SSE_WELCOME_PREFIX}. From 20260707`
    })
    assert.equal(out.errorCode, 'LONG_PROBE_UNAUTH_WELCOME')
    assert.equal(out.welcomeOnly, true)
    assert.equal(out.marathonApplicable, false)
    assert.equal(out.ok, false)
    assert.equal(
      isCursorLongProbeMarathonApplicable({
        welcomeOnly: out.welcomeOnly,
        marathonApplicable: out.marathonApplicable,
        errorCode: out.errorCode
      }),
      false
    )
  })

  it('classifies sustained early close as proxy marathon fault', () => {
    const out = classifyCursorLongProbeOutcome({
      earlyClose: true,
      holdMs: 900_000,
      status: 200,
      ssePrefix: 'data: {"type":"heartbeat"}'
    })
    assert.equal(out.errorCode, 'LONG_STREAM_15M_CAP')
    assert.equal(out.marathonApplicable, true)
  })

  it('classifies short non-welcome close as inconclusive', () => {
    const out = classifyCursorLongProbeOutcome({
      earlyClose: true,
      holdMs: 4_000,
      status: 200,
      ssePrefix: 'data: chunk'
    })
    assert.equal(out.errorCode, 'LONG_PROBE_INCONCLUSIVE')
    assert.equal(out.marathonApplicable, false)
  })
})
