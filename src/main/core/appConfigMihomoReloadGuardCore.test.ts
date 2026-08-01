import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldDeferAppConfigMihomoReload } from './appConfigMihomoReloadGuardCore'

describe('appConfigMihomoReloadGuardCore P10-2', () => {
  it('defers reload when quiesce is active', () => {
    assert.equal(
      shouldDeferAppConfigMihomoReload({
        quiesceActive: true,
        cursorConnectionCount: 0,
        recentActiveLifecycleStreamCount: 0,
      }),
      true,
    )
  })

  it('defers reload at marathon connection threshold', () => {
    assert.equal(
      shouldDeferAppConfigMihomoReload({
        quiesceActive: false,
        cursorConnectionCount: 12,
        recentActiveLifecycleStreamCount: 0,
      }),
      true,
    )
  })

  it('defers reload when active lifecycle streams exist', () => {
    assert.equal(
      shouldDeferAppConfigMihomoReload({
        quiesceActive: false,
        cursorConnectionCount: 0,
        recentActiveLifecycleStreamCount: 2,
      }),
      true,
    )
  })

  it('allows reload when idle', () => {
    assert.equal(
      shouldDeferAppConfigMihomoReload({
        quiesceActive: false,
        cursorConnectionCount: 0,
        recentActiveLifecycleStreamCount: 0,
      }),
      false,
    )
  })
})
