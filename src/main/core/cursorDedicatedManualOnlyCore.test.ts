import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isCursorDedicatedManualOnlySwitchAllowed } from './cursorDedicatedManualOnlyCore'

describe('cursorDedicatedManualOnlyCore', () => {
  it('allows manual user selection', () => {
    assert.equal(
      isCursorDedicatedManualOnlySwitchAllowed({
        source: 'manual',
        fromNode: '🇸🇬 新加坡 02',
      }),
      true,
    )
  })

  it('allows bootstrap only when group has no real selection yet', () => {
    assert.equal(
      isCursorDedicatedManualOnlySwitchAllowed({ source: 'bootstrap', fromNode: undefined }),
      true,
    )
    assert.equal(
      isCursorDedicatedManualOnlySwitchAllowed({ source: 'bootstrap', fromNode: 'SDK DNS' }),
      true,
    )
  })

  it('blocks auto source once a leaf is selected', () => {
    assert.equal(
      isCursorDedicatedManualOnlySwitchAllowed({
        source: 'auto',
        fromNode: '🇸🇬 新加坡 02',
      }),
      false,
    )
  })
})
