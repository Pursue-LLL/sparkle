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
  it('uses trusted standard TLS as the only automatic default', () => {
    assert.equal(CURSOR_DEFAULT_VPS_NODE, 'JP-VPS-TLS')
    assert.equal(
      resolveCursorDefaultVpsNode(new Set(['JP-VPS-Reality', 'KR-VPS-Reality', 'JP-VPS-TLS'])),
      'JP-VPS-TLS'
    )
  })

  it('never auto-falls back to Reality when trusted TLS is unavailable', () => {
    assert.equal(resolveCursorDefaultVpsNode(new Set(['JP-VPS-Reality', 'JP-VPS-HY2'])), undefined)
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
  })

  it('never auto-upgrades Dedicated protocol on bootstrap (500 marathon — no implicit tunnel switch)', () => {
    assert.equal(shouldUpgradeCursorDedicatedNode(undefined, CURSOR_DEFAULT_VPS_NODE), false)
    assert.equal(shouldUpgradeCursorDedicatedNode('SDK DNS', CURSOR_DEFAULT_VPS_NODE), false)
    assert.equal(shouldUpgradeCursorDedicatedNode('JP-VPS-TUIC', CURSOR_DEFAULT_VPS_NODE), false)
    assert.equal(shouldUpgradeCursorDedicatedNode('JP-VPS-HY2', 'JP-VPS-Reality'), false)
    assert.equal(shouldUpgradeCursorDedicatedNode('JP-VPS-Reality', CURSOR_DEFAULT_VPS_NODE), false)
    assert.equal(
      shouldUpgradeCursorDedicatedNode('JP-VPS-Reality', CURSOR_DEFAULT_VPS_NODE, 'JP-VPS-Reality'),
      false
    )
    assert.equal(
      shouldUpgradeCursorDedicatedNode('JP-VPS-HY2', CURSOR_DEFAULT_VPS_NODE, 'JP-VPS-HY2'),
      false
    )
    assert.equal(shouldUpgradeCursorDedicatedNode('JP-VPS-TLS', CURSOR_DEFAULT_VPS_NODE), false)
    assert.equal(
      shouldUpgradeCursorDedicatedNode('Sparkle-自动-新加坡', CURSOR_DEFAULT_VPS_NODE),
      false
    )
  })
})
