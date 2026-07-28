import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  CURSOR_HY2_TOKEN_GAP_FORCE_MS,
} from './cursorHy2MarathonKeepaliveCore'
import {
  API2DIRECT_PROBE_TARGET,
  CONNECT_PATH_PROBE_TARGET,
  CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS,
  CURSOR_CONNECT_STREAM_KEEPALIVE_MIN_INTERVAL_MS,
  detectConnectStreamPartitionStale,
  isConnectStreamRescueEligible,
  shouldRunConnectStreamKeepalive,
} from './cursorConnectStreamKeepaliveCore'

describe('cursorConnectStreamKeepaliveCore', () => {
  it('defers connect stream keepalive at conn>=80 without stale rescue', () => {
    const nowMs = 10_000_000
    assert.equal(
      shouldRunConnectStreamKeepalive(
        80,
        CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS,
        0,
        nowMs,
      ),
      false,
    )
  })

  it('allows connect stream keepalive at conn>=80 from 15s gap with stale rids', () => {
    const nowMs = 10_000_000
    assert.equal(
      shouldRunConnectStreamKeepalive(
        97,
        CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS,
        0,
        nowMs,
        { staleRequestIdCount: 2 },
      ),
      true,
    )
    assert.equal(
      isConnectStreamRescueEligible(CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS, 2),
      true,
    )
    assert.equal(
      shouldRunConnectStreamKeepalive(
        97,
        CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS - 1,
        0,
        nowMs,
        { staleRequestIdCount: 2 },
      ),
      false,
    )
  })

  it('allows connect stream keepalive at conn>=80 when token_gap threshold met', () => {
    const nowMs = 10_000_000
    assert.equal(
      shouldRunConnectStreamKeepalive(
        97,
        CURSOR_HY2_TOKEN_GAP_FORCE_MS,
        0,
        nowMs,
        { staleRequestIdCount: 2 },
      ),
      true,
    )
    assert.equal(
      shouldRunConnectStreamKeepalive(
        97,
        CURSOR_HY2_TOKEN_GAP_FORCE_MS,
        0,
        nowMs,
        { staleRequestIdCount: 0 },
      ),
      false,
    )
  })

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

  it('targets agentn Connect path for split-brain probe', () => {
    assert.equal(CONNECT_PATH_PROBE_TARGET, 'https://agentn.global.api5.cursor.sh')
  })

  it('detects connect_path partition when HTTP green but Connect path dead', () => {
    assert.equal(detectConnectStreamPartitionStale(245, 358, 0), true)
    assert.equal(detectConnectStreamPartitionStale(245, 358, 120), false)
    assert.equal(detectConnectStreamPartitionStale(0, 0, 0), false)
  })

  it('allows sudden silent generation end rescue below 15s gap at conn>=80', () => {
    const nowMs = 10_000_000
    assert.equal(
      isConnectStreamRescueEligible(7622, 2, true),
      true,
    )
    assert.equal(
      shouldRunConnectStreamKeepalive(
        97,
        7622,
        0,
        nowMs,
        { staleRequestIdCount: 2, suddenSilentGenerationEnd: true },
      ),
      true,
    )
  })
})
