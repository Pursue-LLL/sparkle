import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_CONN_DUPLICATE_PER_HOST_MAX,
  CURSOR_CONN_IDLE_MIN_AGE_MS,
  isCursorConnection,
  selectGlobalIdleCursorConnectionsToClose,
  selectStaleCursorConnectionsToClose,
  shouldDeferNetworkProbeForCursorLoad,
  mergeConnectionIdsToClose,
  type ConnectionHygieneRow
} from './cursorConnectionHygieneCore'

const NOW = Date.parse('2026-07-08T12:00:00.000Z')

function row(partial: Partial<ConnectionHygieneRow> & Pick<ConnectionHygieneRow, 'id'>): ConnectionHygieneRow {
  return {
    processPath: '/Applications/Cursor-3.1.15.app/Contents/MacOS/Cursor',
    process: 'Cursor Helper',
    host: 'agent.api5.cursor.sh',
    startMs: NOW - CURSOR_CONN_IDLE_MIN_AGE_MS - 60_000,
    uploadSpeed: 0,
    downloadSpeed: 0,
    ...partial
  }
}

describe('cursorConnectionHygieneCore', () => {
  it('detects Cursor bundle paths', () => {
    assert.equal(
      isCursorConnection(row({ id: 'a', processPath: '/Applications/Cursor.app/Contents/MacOS/Cursor' })),
      true
    )
    assert.equal(isCursorConnection(row({ id: 'b', processPath: '/Applications/Firefox.app', process: 'firefox' })), false)
  })

  it('defers probes when Cursor connection count is high', () => {
    assert.equal(shouldDeferNetworkProbeForCursorLoad(19), false)
    assert.equal(shouldDeferNetworkProbeForCursorLoad(20), true)
  })

  it('closes only idle duplicates beyond per-host cap', () => {
    const rows: ConnectionHygieneRow[] = []
    for (let index = 0; index < CURSOR_CONN_DUPLICATE_PER_HOST_MAX + 2; index += 1) {
      rows.push(
        row({
          id: `id-${index}`,
          startMs: NOW - index * 60_000 - CURSOR_CONN_IDLE_MIN_AGE_MS
        })
      )
    }
    for (let index = 0; index < 6; index += 1) {
      rows.push(
        row({
          id: `other-${index}`,
          host: `api2.cursor.sh-${index}`,
          startMs: NOW - CURSOR_CONN_IDLE_MIN_AGE_MS - 120_000
        })
      )
    }
    rows.push(
      row({
        id: 'active',
        startMs: NOW - 5 * 60_000,
        downloadSpeed: 1200
      })
    )

    const stale = selectStaleCursorConnectionsToClose(rows, NOW)
    assert.equal(stale.length, 3)
    assert.ok(stale.includes('id-3'))
    assert.ok(stale.includes('id-4'))
    assert.ok(stale.includes('id-5'))
    assert.ok(!stale.includes('active'))
  })

  it('skips hygiene below minimum connection count', () => {
    const rows = [row({ id: 'only' })]
    assert.deepEqual(selectStaleCursorConnectionsToClose(rows, NOW), [])
  })

  it('merges duplicate and global prune ids without duplicates', () => {
    const merged = mergeConnectionIdsToClose(['a', 'b'], ['b', 'c'])
    assert.deepEqual(merged.sort(), ['a', 'b', 'c'])
  })

  it('prunes global idle sockets when majority are stale', () => {
    const rows: ConnectionHygieneRow[] = []
    for (let index = 0; index < 22; index += 1) {
      rows.push(
        row({
          id: `idle-${index}`,
          host: `host-${index % 11}`,
          startMs: NOW - CURSOR_CONN_IDLE_MIN_AGE_MS - index * 1000
        })
      )
    }
    rows.push(
      row({
        id: 'live',
        startMs: NOW - 60_000,
        downloadSpeed: 900
      })
    )

    const global = selectGlobalIdleCursorConnectionsToClose(rows, NOW)
    assert.ok(global.length >= 10)
    assert.ok(!global.includes('live'))
  })
})
