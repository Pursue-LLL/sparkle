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
  it('prefers Reality as marathon-optimal bootstrap default', () => {
    assert.equal(CURSOR_DEFAULT_VPS_NODE, 'KR-VPS-Reality')
    assert.equal(resolveCursorDefaultVpsNode(new Set(['KR-VPS-Reality'])), 'KR-VPS-Reality')
    assert.equal(resolveCursorDefaultVpsNode(new Set(['KR-VPS-HY2'])), undefined)
  })

  it('prefers Reality over HY2 when available', () => {
    assert.equal(resolveCursorDefaultVpsNode(new Set(['KR-VPS-Reality', 'KR-VPS-HY2'])), 'KR-VPS-Reality')
  })

  it('marks UDP VPS transports as suboptimal for automatic selection', () => {
    assert.equal(isCursorSuboptimalNode('KR-VPS-TUIC'), true)
    assert.equal(isCursorSuboptimalNode('KR-VPS-HY2'), true)
    assert.equal(isCursorSuboptimalNode('KR-VPS-Reality'), false)
    assert.equal(isCursorSuboptimalNode('KR-VPS-TLS'), false)
  })

  it('only treats migration from suboptimal UDP to trusted TLS/Reality as a protocol upgrade', () => {
    assert.equal(isCursorProtocolUpgrade('KR-VPS-HY2', 'KR-VPS-TLS'), true)
    assert.equal(isCursorProtocolUpgrade('KR-VPS-TUIC', 'KR-VPS-TLS'), true)
    assert.equal(isCursorProtocolUpgrade('KR-VPS-HY2', 'KR-VPS-Reality'), true)
    assert.equal(isCursorProtocolUpgrade('KR-VPS-Reality', 'KR-VPS-Reality'), false)
    assert.equal(isCursorProtocolUpgrade('KR-VPS-HY2', 'KR-VPS-HY2'), false)
  })

  it('does not override an existing Cursor dedicated selection on bootstrap', () => {
    assert.equal(shouldApplyCursorDedicatedDefault(undefined), true)
    assert.equal(shouldApplyCursorDedicatedDefault('SDK DNS'), true)
    assert.equal(shouldApplyCursorDedicatedDefault('Sparkle-新加坡'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('KR-VPS-TUIC'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('KR-VPS-Reality'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('DIRECT'), false)
  })
})
