import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_DEFAULT_VPS_NODE,
  isCursorProtocolUpgrade,
  isCursorSuboptimalNode,
  resolveCursorDefaultVpsNode,
  shouldApplyCursorDedicatedDefault,
} from './cursorDedicatedDefault'

describe('cursorDedicatedDefault', () => {
  it('prefers HY2 as marathon-optimal bootstrap default', () => {
    assert.equal(CURSOR_DEFAULT_VPS_NODE, 'JP-VPS-HY2')
    assert.equal(
      resolveCursorDefaultVpsNode(new Set(['JP-VPS-Reality', 'KR-VPS-Reality', 'JP-VPS-TLS', 'JP-VPS-HY2'])),
      'JP-VPS-HY2',
    )
    assert.equal(resolveCursorDefaultVpsNode(new Set(['JP-VPS-Reality', 'JP-VPS-TLS'])), undefined)
  })

  it('prefers HY2 over Reality when TLS unavailable — never auto-falls back to Reality', () => {
    assert.equal(resolveCursorDefaultVpsNode(new Set(['JP-VPS-Reality', 'JP-VPS-HY2'])), 'JP-VPS-HY2')
    assert.equal(resolveCursorDefaultVpsNode(new Set(['JP-VPS-Reality', 'KR-VPS-Reality'])), undefined)
  })

  it('marks Reality and UDP VPS transports as suboptimal for automatic selection', () => {
    assert.equal(isCursorSuboptimalNode('KR-VPS-TUIC'), true)
    assert.equal(isCursorSuboptimalNode('JP-VPS-HY2'), true)
    assert.equal(isCursorSuboptimalNode('KR-VPS-HY2'), true)
    assert.equal(isCursorSuboptimalNode('JP-VPS-Reality'), true)
    assert.equal(isCursorSuboptimalNode('KR-VPS-Reality'), true)
    assert.equal(isCursorSuboptimalNode('JP-VPS-TLS'), false)
  })

  it('only treats migration to trusted TLS as a protocol upgrade', () => {
    assert.equal(isCursorProtocolUpgrade('JP-VPS-HY2', 'JP-VPS-TLS'), true)
    assert.equal(isCursorProtocolUpgrade('KR-VPS-TUIC', 'JP-VPS-TLS'), true)
    assert.equal(isCursorProtocolUpgrade('KR-VPS-Reality', 'JP-VPS-TLS'), true)
    assert.equal(isCursorProtocolUpgrade('KR-VPS-Reality', 'JP-VPS-Reality'), false)
    assert.equal(isCursorProtocolUpgrade('JP-VPS-HY2', 'KR-VPS-HY2'), false)
  })

  it('does not override an existing Cursor dedicated selection on bootstrap', () => {
    assert.equal(shouldApplyCursorDedicatedDefault(undefined), true)
    assert.equal(shouldApplyCursorDedicatedDefault('SDK DNS'), true)
    assert.equal(shouldApplyCursorDedicatedDefault('Sparkle-自动-新加坡'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('JP-VPS-TUIC'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('JP-VPS-Reality'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('DIRECT'), false)
  })
})
