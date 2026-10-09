import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_DEFAULT_VPS_NODE,
  resolveCursorDefaultVpsNode,
  shouldApplyCursorDedicatedDefault,
} from './cursorDedicatedDefault'

describe('cursorDedicatedDefault', () => {
  it('prefers Reality as bootstrap default', () => {
    assert.equal(CURSOR_DEFAULT_VPS_NODE, 'KR-VPS-Reality')
    assert.equal(resolveCursorDefaultVpsNode(new Set(['KR-VPS-Reality'])), 'KR-VPS-Reality')
    assert.equal(resolveCursorDefaultVpsNode(new Set(['KR-VPS-HY2'])), undefined)
  })

  it('prefers Reality over HY2 when available', () => {
    assert.equal(resolveCursorDefaultVpsNode(new Set(['KR-VPS-Reality', 'KR-VPS-HY2'])), 'KR-VPS-Reality')
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
