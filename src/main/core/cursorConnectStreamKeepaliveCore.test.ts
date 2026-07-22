import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_HY2_MARATHON_CONN_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'
import {
  API2DIRECT_PROBE_TARGET,
  CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS,
  CURSOR_CONNECT_STREAM_KEEPALIVE_MIN_INTERVAL_MS,
  shouldRunConnectStreamKeepalive,
} from './cursorConnectStreamKeepaliveCore'

describe('cursorConnectStreamKeepaliveCore', () => {
  it('requires marathon load and gap >= 15s', () => {
    const nowMs = 10_000_000
    assert.equal(
      shouldRunConnectStreamKeepalive(
        CURSOR_HY2_MARATHON_CONN_THRESHOLD,
        CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS,
        0,
        nowMs,
      ),
      true,
    )
    assert.equal(
      shouldRunConnectStreamKeepalive(
        CURSOR_HY2_MARATHON_CONN_THRESHOLD - 1,
        CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS,
        0,
        nowMs,
      ),
      false,
    )
    assert.equal(
      shouldRunConnectStreamKeepalive(
        CURSOR_HY2_MARATHON_CONN_THRESHOLD,
        CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS - 1,
        0,
        nowMs,
      ),
      false,
    )
  })

  it('respects min interval between keepalive probes', () => {
    const nowMs = 20_000_000
    const lastAt = nowMs - CURSOR_CONNECT_STREAM_KEEPALIVE_MIN_INTERVAL_MS + 1
    assert.equal(
      shouldRunConnectStreamKeepalive(
        30,
        20_000,
        lastAt,
        nowMs,
      ),
      false,
    )
    assert.equal(
      shouldRunConnectStreamKeepalive(
        30,
        20_000,
        nowMs - CURSOR_CONNECT_STREAM_KEEPALIVE_MIN_INTERVAL_MS,
        nowMs,
      ),
      true,
    )
  })

  it('targets api2direct Connect transport host', () => {
    assert.equal(API2DIRECT_PROBE_TARGET, 'https://api2direct.cursor.sh')
  })
})
