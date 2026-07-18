import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_DEFAULT_VPS_NODE,
  isCursorProtocolUpgrade,
  isCursorSuboptimalNode,
  resolveCursorDefaultVpsNode,
  shouldApplyCursorDedicatedDefault,
  shouldUpgradeCursorDedicatedNode
} from './cursorDedicatedDefault'

describe('cursorDedicatedDefault', () => {
  it('prefers KR-VPS-Reality as default VPS node (company network stability)', () => {
    assert.equal(CURSOR_DEFAULT_VPS_NODE, 'KR-VPS-Reality')
    assert.equal(
      resolveCursorDefaultVpsNode(new Set(['JP-VPS-Reality', 'KR-VPS-Reality'])),
      'KR-VPS-Reality'
    )
  })

  it('falls back to JP-VPS-Reality when KR is unavailable', () => {
    assert.equal(
      resolveCursorDefaultVpsNode(new Set(['JP-VPS-Reality', 'JP-VPS-HY2'])),
      'JP-VPS-Reality'
    )
  })

  it('marks UDP VPS leaf nodes as suboptimal for marathon stability', () => {
    assert.equal(isCursorSuboptimalNode('KR-VPS-TUIC'), true)
    assert.equal(isCursorSuboptimalNode('JP-VPS-HY2'), true)
    assert.equal(isCursorSuboptimalNode('KR-VPS-HY2'), true)
    assert.equal(isCursorSuboptimalNode('JP-VPS-Reality'), false)
    assert.equal(isCursorSuboptimalNode('KR-VPS-Reality'), false)
  })

  it('treats HY2/TUIC → Reality as protocol upgrade (bypass defer)', () => {
    assert.equal(isCursorProtocolUpgrade('JP-VPS-HY2', 'KR-VPS-Reality'), true)
    assert.equal(isCursorProtocolUpgrade('KR-VPS-TUIC', 'JP-VPS-Reality'), true)
    assert.equal(isCursorProtocolUpgrade('KR-VPS-Reality', 'JP-VPS-Reality'), false)
    assert.equal(isCursorProtocolUpgrade('JP-VPS-HY2', 'KR-VPS-HY2'), false)
  })

  it('does not override an existing Cursor dedicated selection on bootstrap', () => {
    assert.equal(shouldApplyCursorDedicatedDefault(undefined), true)
    assert.equal(shouldApplyCursorDedicatedDefault('SDK DNS'), true)
    assert.equal(shouldApplyCursorDedicatedDefault('Sparkle-自动-新加坡'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('JP-VPS-TUIC'), false)
    assert.equal(shouldApplyCursorDedicatedDefault('JP-VPS-Reality'), false)
  })

  it('upgrades suboptimal UDP nodes and JP-Reality to KR-Reality default', () => {
    assert.equal(shouldUpgradeCursorDedicatedNode(undefined, CURSOR_DEFAULT_VPS_NODE), true)
    assert.equal(shouldUpgradeCursorDedicatedNode('SDK DNS', CURSOR_DEFAULT_VPS_NODE), true)
    assert.equal(shouldUpgradeCursorDedicatedNode('JP-VPS-TUIC', CURSOR_DEFAULT_VPS_NODE), true)
    assert.equal(shouldUpgradeCursorDedicatedNode('JP-VPS-Reality', CURSOR_DEFAULT_VPS_NODE), false)
    assert.equal(shouldUpgradeCursorDedicatedNode('JP-VPS-Reality', CURSOR_DEFAULT_VPS_NODE, 'JP-VPS-Reality'), false)
    assert.equal(shouldUpgradeCursorDedicatedNode('JP-VPS-HY2', CURSOR_DEFAULT_VPS_NODE, 'JP-VPS-HY2'), false)
    assert.equal(shouldUpgradeCursorDedicatedNode('KR-VPS-Reality', CURSOR_DEFAULT_VPS_NODE), false)
    assert.equal(shouldUpgradeCursorDedicatedNode('Sparkle-自动-新加坡', CURSOR_DEFAULT_VPS_NODE), false)
  })
})
