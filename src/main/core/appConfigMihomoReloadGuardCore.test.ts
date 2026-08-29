import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  shouldDeferAppConfigMihomoReload,
  shouldDeferMihomoReloadFromGuardStateFile,
} from './appConfigMihomoReloadGuardCore'

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

  it('defers reload when any cursor connection is active (conn=1)', () => {
    assert.equal(
      shouldDeferAppConfigMihomoReload({
        quiesceActive: false,
        cursorConnectionCount: 1,
        recentActiveLifecycleStreamCount: 0,
      }),
      true,
    )
  })

  it('defers reload for typical agent session load (conn=7)', () => {
    assert.equal(
      shouldDeferAppConfigMihomoReload({
        quiesceActive: false,
        cursorConnectionCount: 7,
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

  it('defers reload when cursor connection observation is unavailable', () => {
    assert.equal(
      shouldDeferAppConfigMihomoReload({
        quiesceActive: false,
        cursorConnectionCount: -1,
        recentActiveLifecycleStreamCount: 0,
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

  it('defers reload script when guard state file marks blockColdRestart', () => {
    assert.equal(
      shouldDeferMihomoReloadFromGuardStateFile({
        blockColdRestart: true,
        cursorConnectionCount: 0,
        recentActiveLifecycleStreamCount: 0,
        quiesceActive: false,
      }),
      true,
    )
  })

  it('defers reload script when guard state reports active cursor connections', () => {
    assert.equal(
      shouldDeferMihomoReloadFromGuardStateFile({
        blockColdRestart: false,
        cursorConnectionCount: 3,
        recentActiveLifecycleStreamCount: 0,
        quiesceActive: false,
      }),
      true,
    )
  })
})
