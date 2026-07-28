import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  CURSOR_HY2_NUDGE_DEFER_THRESHOLD,
  CURSOR_HY2_SESSION_KEEPALIVE_INTERVAL_MS,
  HY2_QUIC_IDLE_TIMEOUT,
  HY2_QUIC_KEEPALIVE_PERIOD,
  HY2_QUIC_KEEPALIVE_PERIOD_SEC,
  hy2InQuicMarathonFields,
  isHy2CursorNode,
  isMarathonQuIcInboundCursorNode,
  isMarathonRescueTrigger,
  isTokenGapRescueEligible,
  resolveMarathonWarmthLogKind,
  shouldDeferMarathonWarmth,
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

test('shouldDeferMarathonWarmth defers warmth but not rescue at conn>=80', async () => {
  const { CURSOR_HY2_TOKEN_GAP_FORCE_MS } = await import('./cursorHy2MarathonKeepaliveCore')
  assert.equal(
    shouldDeferMarathonWarmth(CURSOR_HY2_NUDGE_DEFER_THRESHOLD - 1, 'periodic_session'),
    false,
  )
  assert.equal(
    shouldDeferMarathonWarmth(CURSOR_HY2_NUDGE_DEFER_THRESHOLD, 'periodic_session'),
    true,
  )
  assert.equal(shouldDeferMarathonWarmth(268, 'high_latency_warmth'), true)
  assert.equal(shouldDeferMarathonWarmth(97, 'connect_partition'), false)
  assert.equal(shouldDeferMarathonWarmth(97, 'latency_delta_rescue'), false)
  assert.equal(shouldDeferMarathonWarmth(97, 'silent_generation_end'), false)
  assert.equal(
    shouldDeferMarathonWarmth(97, 'token_gap', {
      maxGapMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS,
      staleRequestIdCount: 2,
    }),
    false,
  )
  assert.equal(
    shouldDeferMarathonWarmth(97, 'token_gap', {
      maxGapMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS - 1,
      staleRequestIdCount: 2,
    }),
    true,
  )
  assert.equal(
    shouldDeferMarathonWarmth(97, 'cold_resume', { staleRequestIdCount: 1 }),
    false,
  )
  assert.equal(
    shouldDeferMarathonWarmth(97, 'cold_resume', { staleRequestIdCount: 0 }),
    true,
  )
})

test('isMarathonRescueTrigger and resolveMarathonWarmthLogKind', () => {
  assert.equal(isMarathonRescueTrigger('connect_partition'), true)
  assert.equal(isMarathonRescueTrigger('latency_delta_rescue'), true)
  assert.equal(isMarathonRescueTrigger('silent_generation_end'), true)
  assert.equal(isMarathonRescueTrigger('token_gap'), true)
  assert.equal(isMarathonRescueTrigger('periodic_session'), false)
  assert.equal(resolveMarathonWarmthLogKind('connect_partition'), 'connect_partition_rescue_nudge')
  assert.equal(resolveMarathonWarmthLogKind('latency_delta_rescue'), 'latency_delta_rescue_nudge')
  assert.equal(resolveMarathonWarmthLogKind('silent_generation_end'), 'silent_generation_end_rescue_nudge')
  assert.equal(resolveMarathonWarmthLogKind('token_gap'), 'token_gap_rescue_nudge')
  assert.equal(resolveMarathonWarmthLogKind('cold_resume'), 'cold_resume_rescue_nudge')
})

test('isTokenGapRescueEligible requires stale rids and gap threshold', async () => {
  const { CURSOR_HY2_TOKEN_GAP_FORCE_MS } = await import('./cursorHy2MarathonKeepaliveCore')
  assert.equal(isTokenGapRescueEligible(CURSOR_HY2_TOKEN_GAP_FORCE_MS, 1), true)
  assert.equal(isTokenGapRescueEligible(CURSOR_HY2_TOKEN_GAP_FORCE_MS - 1, 1), false)
  assert.equal(isTokenGapRescueEligible(CURSOR_HY2_TOKEN_GAP_FORCE_MS, 0), false)
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

test('shouldForceHy2MarathonSessionKeepaliveForHighLatency under marathon load', async () => {
  const { shouldForceHy2MarathonSessionKeepaliveForHighLatency, CURSOR_HY2_HIGH_LATENCY_FORCE_NUDGE_MS, CURSOR_HY2_MARATHON_CONN_THRESHOLD } =
    await import('./cursorHy2MarathonKeepaliveCore')
  assert.equal(
    shouldForceHy2MarathonSessionKeepaliveForHighLatency(
      CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      CURSOR_HY2_HIGH_LATENCY_FORCE_NUDGE_MS,
    ),
    true,
  )
  assert.equal(
    shouldForceHy2MarathonSessionKeepaliveForHighLatency(
      CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      CURSOR_HY2_HIGH_LATENCY_FORCE_NUDGE_MS - 1,
    ),
    false,
  )
  assert.equal(
    shouldForceHy2MarathonSessionKeepaliveForHighLatency(
      CURSOR_HY2_MARATHON_CONN_THRESHOLD - 1,
      CURSOR_HY2_HIGH_LATENCY_FORCE_NUDGE_MS + 100,
    ),
    false,
  )
})

test('shouldForceHy2MarathonSessionKeepaliveForTokenGap under marathon load', async () => {
  const {
    shouldForceHy2MarathonSessionKeepaliveForTokenGap,
    CURSOR_HY2_TOKEN_GAP_FORCE_MS,
    CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  } = await import('./cursorHy2MarathonKeepaliveCore')
  assert.equal(
    shouldForceHy2MarathonSessionKeepaliveForTokenGap(
      CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      CURSOR_HY2_TOKEN_GAP_FORCE_MS,
    ),
    true,
  )
  assert.equal(
    shouldForceHy2MarathonSessionKeepaliveForTokenGap(
      CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      CURSOR_HY2_TOKEN_GAP_FORCE_MS - 1,
    ),
    false,
  )
  assert.equal(
    shouldForceHy2MarathonSessionKeepaliveForTokenGap(
      CURSOR_HY2_MARATHON_CONN_THRESHOLD - 1,
      CURSOR_HY2_TOKEN_GAP_FORCE_MS + 100,
    ),
    false,
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

test('formatMarathonRescueNudgeLogLine emits outcome SSOT for triage', async () => {
  const { formatMarathonRescueNudgeLogLine } = await import('./cursorHy2MarathonKeepaliveCore')
  const deferred = formatMarathonRescueNudgeLogLine(
    'token_gap',
    { outcome: 'skipped_deferred' },
    { cursorConnectionCount: 97, maxGapMs: 148195, staleRids: 'rid-a,rid-b' },
  )
  assert.match(deferred, /token_gap_nudge outcome=skipped_deferred cursor_conn=97 max_gap_ms=148195/)
  const executed = formatMarathonRescueNudgeLogLine(
    'token_gap',
    { outcome: 'executed', api2DelayMs: 120, api2geoDelayMs: 95 },
    { cursorConnectionCount: 80, maxGapMs: 22000, staleRids: 'rid-c' },
  )
  assert.match(executed, /outcome=executed/)
  assert.match(executed, /api2_delay_ms=120/)
  assert.match(executed, /api2geo_delay_ms=95/)
  const failed = formatMarathonRescueNudgeLogLine(
    'token_gap',
    { outcome: 'failed', err: '{"message":"timeout"}' },
    { cursorConnectionCount: 29, maxGapMs: 155878 },
  )
  assert.match(failed, /outcome=failed/)
  assert.match(failed, /err=\{"message":"timeout"\}/)
})
