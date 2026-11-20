import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACTIVE_HEAD_MAX_AGE_MS,
  headVerdictMaxAgeMs,
  HEAD_GUARD_TICK_MS,
  IDLE_HEAD_MAX_AGE_MS,
  isGeminiActivityLog
} from './sparkleGeminiGuardCore'

describe('sparkleGeminiGuardCore head verdict age', () => {
  it('is tighter while Gemini is in use than while it is idle', () => {
    assert.equal(headVerdictMaxAgeMs(true), ACTIVE_HEAD_MAX_AGE_MS)
    assert.equal(headVerdictMaxAgeMs(false), IDLE_HEAD_MAX_AGE_MS)
    assert.ok(ACTIVE_HEAD_MAX_AGE_MS < IDLE_HEAD_MAX_AGE_MS)
  })

  it('makes every tick re-verify during use, and idle checks land on a tick', () => {
    assert.ok(ACTIVE_HEAD_MAX_AGE_MS < HEAD_GUARD_TICK_MS, 'a tick never finds a fresh verdict')
    assert.equal(IDLE_HEAD_MAX_AGE_MS % HEAD_GUARD_TICK_MS, 0, 'no wasted wait past the age')
  })
})

describe('sparkleGeminiGuardCore isGeminiActivityLog', () => {
  it('counts the line every connection through the group leaves', () => {
    assert.equal(
      isGeminiActivityLog(
        '[TCP] 198.18.0.1:59676(Browser Helper (Aperitif)) --> gemini.google.com:443 match DomainSuffix(gemini.google.com) using gemini专用[台湾-优化]'
      ),
      true
    )
  })

  it('counts a failed dial through the group', () => {
    assert.equal(
      isGeminiActivityLog(
        '[TCP] dial gemini专用 (match DomainSuffix/gemini.google.com) 127.0.0.1:62817(curl) --> gemini.google.com:443 error: i/o timeout'
      ),
      true
    )
  })

  it('does not count provider lifecycle lines that merely name the group', () => {
    assert.equal(isGeminiActivityLog('Start initial provider gemini专用'), false)
    assert.equal(isGeminiActivityLog("[Provider] gemini专用's content update"), false)
  })

  it('does not count other groups or the hidden probe channel', () => {
    assert.equal(
      isGeminiActivityLog('[TCP] x --> github.com:443 match using 自动选择[日本-1]'),
      false
    )
    assert.equal(
      isGeminiActivityLog(
        '[TCP] 127.0.0.1:58300 --> gemini.google.com:443 using __sparkle_mail_probe__[🇭🇰 香港 02]'
      ),
      false
    )
  })

  it('has nothing to read in a log without a payload', () => {
    assert.equal(isGeminiActivityLog(undefined), false)
    assert.equal(isGeminiActivityLog(''), false)
  })
})
