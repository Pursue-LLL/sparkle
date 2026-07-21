import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  CURSOR_HY2_SESSION_KEEPALIVE_INTERVAL_MS,
  HY2_QUIC_IDLE_TIMEOUT,
  HY2_QUIC_KEEPALIVE_PERIOD,
  HY2_QUIC_KEEPALIVE_PERIOD_SEC,
  hy2InQuicMarathonFields,
  isHy2CursorNode,
  isMarathonQuIcInboundCursorNode,
  shouldRunHy2MarathonSessionKeepalive,
  tuicInQuicMarathonFields
} from './cursorHy2MarathonKeepaliveCore'

test('isHy2CursorNode matches VPS HY2 leaf names', () => {
  assert.equal(isHy2CursorNode('JP-VPS-HY2'), true)
  assert.equal(isHy2CursorNode('KR-VPS-HY2'), true)
  assert.equal(isHy2CursorNode('JP-VPS-Reality'), false)
  assert.equal(isHy2CursorNode('JP-VPS-TUIC'), false)
})

test('isMarathonQuIcInboundCursorNode matches HY2 and TUIC marathon nodes', () => {
  assert.equal(isMarathonQuIcInboundCursorNode('JP-VPS-HY2'), true)
  assert.equal(isMarathonQuIcInboundCursorNode('JP-VPS-TUIC'), true)
  assert.equal(isMarathonQuIcInboundCursorNode('KR-VPS-TUIC'), true)
  assert.equal(isMarathonQuIcInboundCursorNode('JP-VPS-Reality'), false)
})

test('shouldRunHy2MarathonSessionKeepalive requires HY2/TUIC active and marathon load', () => {
  const base = {
    activeNode: 'JP-VPS-HY2',
    cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
    lastKeepaliveAtMs: 0,
    nowMs: 1_000_000
  }
  assert.equal(shouldRunHy2MarathonSessionKeepalive(base), true)
  assert.equal(
    shouldRunHy2MarathonSessionKeepalive({
      ...base,
      activeNode: 'JP-VPS-TUIC'
    }),
    true
  )
  assert.equal(
    shouldRunHy2MarathonSessionKeepalive({
      ...base,
      activeNode: 'JP-VPS-Reality'
    }),
    false
  )
  assert.equal(
    shouldRunHy2MarathonSessionKeepalive({
      ...base,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD - 1
    }),
    false
  )
})

test('shouldRunHy2MarathonSessionKeepalive respects interval', () => {
  const nowMs = 10_000_000
  const lastKeepaliveAtMs = nowMs - CURSOR_HY2_SESSION_KEEPALIVE_INTERVAL_MS + 1
  assert.equal(
    shouldRunHy2MarathonSessionKeepalive({
      activeNode: 'JP-VPS-HY2',
      cursorConnectionCount: 72,
      lastKeepaliveAtMs,
      nowMs
    }),
    false
  )
  assert.equal(
    shouldRunHy2MarathonSessionKeepalive({
      activeNode: 'JP-VPS-HY2',
      cursorConnectionCount: 72,
      lastKeepaliveAtMs: nowMs - CURSOR_HY2_SESSION_KEEPALIVE_INTERVAL_MS,
      nowMs
    }),
    true
  )
})

test('shouldRunHy2MarathonSessionKeepalive rejects blank node names', () => {
  assert.equal(
    shouldRunHy2MarathonSessionKeepalive({
      activeNode: '  ',
      cursorConnectionCount: 20,
      lastKeepaliveAtMs: 0,
      nowMs: 1
    }),
    false
  )
})

test('hy2InQuicMarathonFields and VPS hy2-in/tuic-in align with session nudge interval', () => {
  const fields = hy2InQuicMarathonFields()
  const tuicFields = tuicInQuicMarathonFields()
  assert.equal(fields.udp_timeout, HY2_QUIC_IDLE_TIMEOUT)
  assert.equal(fields.idle_timeout, HY2_QUIC_IDLE_TIMEOUT)
  assert.equal(fields.keep_alive_period, HY2_QUIC_KEEPALIVE_PERIOD)
  assert.deepEqual(tuicFields, fields)
  assert.equal(HY2_QUIC_IDLE_TIMEOUT, '3600s')
  assert.ok(
    HY2_QUIC_KEEPALIVE_PERIOD_SEC * 1000 < CURSOR_HY2_SESSION_KEEPALIVE_INTERVAL_MS,
    'client transport nudge interval should exceed server keepalive period constant',
  )
})
