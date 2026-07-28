import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertPostQuitInstallAllowed,
  buildPreInstallCursorConnSnapshot,
  parsePreInstallCursorConnSnapshot,
  PRE_INSTALL_SNAPSHOT_MAX_AGE_MS,
  readFreshMarathonGuardStatePayload,
} from './marathonInstallCursorConnSnapshotCore'

describe('marathonInstallCursorConnSnapshotCore', () => {
  it('builds snapshot with non-negative cursor_conn', () => {
    const snapshot = buildPreInstallCursorConnSnapshot({
      cursorConnectionCount: 3,
      quiesceActive: true,
      blockColdRestart: true,
      caller: 'install-sparkle-local-pre-quit',
      capturedAtMs: 1_000,
    })
    assert.equal(snapshot.cursorConnectionCount, 3)
    assert.equal(snapshot.quiesceActive, true)
    assert.equal(snapshot.blockColdRestart, true)
  })

  it('blocks post-quit when snapshot shows active cursor_conn', () => {
    const snapshot = buildPreInstallCursorConnSnapshot({
      cursorConnectionCount: 2,
      quiesceActive: false,
      blockColdRestart: false,
      caller: 'pre-quit',
      capturedAtMs: 5_000,
    })
    const decision = assertPostQuitInstallAllowed(snapshot, 6_000)
    assert.equal(decision.allowed, false)
    assert.match(decision.reason, /cursor_conn_active/)
  })

  it('blocks post-quit when quiesce was active at pre-quit even if conn=0', () => {
    const snapshot = buildPreInstallCursorConnSnapshot({
      cursorConnectionCount: 0,
      quiesceActive: true,
      blockColdRestart: true,
      caller: 'pre-quit',
      capturedAtMs: 5_000,
    })
    const decision = assertPostQuitInstallAllowed(snapshot, 6_000)
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'marathon_quiesce_active')
  })

  it('fail-closed when snapshot missing', () => {
    const decision = assertPostQuitInstallAllowed(null)
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'missing_pre_quit_snapshot')
  })

  it('fail-closed when snapshot stale', () => {
    const snapshot = buildPreInstallCursorConnSnapshot({
      cursorConnectionCount: 0,
      quiesceActive: false,
      blockColdRestart: false,
      caller: 'pre-quit',
      capturedAtMs: 0,
    })
    const decision = assertPostQuitInstallAllowed(
      snapshot,
      PRE_INSTALL_SNAPSHOT_MAX_AGE_MS + 1,
    )
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'stale_pre_quit_snapshot')
  })

  it('parses snapshot json', () => {
    const parsed = parsePreInstallCursorConnSnapshot({
      cursorConnectionCount: 1,
      quiesceActive: false,
      blockColdRestart: false,
      capturedAtMs: 100,
      caller: 'x',
    })
    assert.ok(parsed)
    assert.equal(parsed?.cursorConnectionCount, 1)
  })

  it('reads fresh guard state payload only within max age', () => {
    const nowMs = 200_000
    assert.equal(
      readFreshMarathonGuardStatePayload({ updatedAtMs: nowMs - 121_000 }, nowMs),
      null,
    )
    assert.equal(
      readFreshMarathonGuardStatePayload({ updatedAtMs: nowMs - 60_000, quiesceActive: true }, nowMs)
        ?.quiesceActive,
      true,
    )
  })
})
