import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS,
  detectConnectPartitionSignal,
  isConnectPingTransportFailure,
  resolveConnectPartitionWindowMs,
  shouldTreatHealthyProbeAsConnectPartition,
} from './connectPartitionDetectCore'
import { HUNG_SCAN_INTERVAL_MS } from './cursorTransportHealthCore'
import { resolveProbeAttributionWithConnectPartition } from './cursorTransportHealthCore'

const NOW = Date.parse('2026-07-20T08:00:24.000Z')

describe('connectPartitionDetectCore', () => {
  it('detects PING timed out and connect code 14', () => {
    assert.equal(
      isConnectPingTransportFailure({ errMsg: 'PING timed out', connectCode: '14' }),
      true,
    )
    assert.equal(
      isConnectPingTransportFailure({ errMsg: 'read ETIMEDOUT', connectCode: '14' }),
      true,
    )
    assert.equal(
      isConnectPingTransportFailure({
        errMsg: 'read ETIMEDOUT',
        connectCode: '14',
        reasonSub: 'read-timeout',
      }),
      true,
    )
    assert.equal(isConnectPingTransportFailure({ errMsg: 'other', connectCode: '14' }), false)
  })

  it('returns signal when mass PING in window with high cursor_conn', () => {
    const signal = detectConnectPartitionSignal(
      [
        {
          ts: NOW - 2_000,
          errMsg: 'PING timed out',
          connectCode: '14',
          originalRequestId: '5d03320f-c7bc-4772-8982-2a66c88db65c',
        },
        {
          ts: NOW - 1_000,
          errMsg: '[unavailable] PING timed out',
          connectCode: '14',
          requestId: '13592c36-0352-4e22-b697-81cf5647fc14',
        },
      ],
      { nowMs: NOW, cursorConnectionCount: 30 },
    )
    assert.equal(signal?.pingFailureCount, 2)
    assert.equal(signal?.sampleRequestIds.length, 2)
  })

  it('returns signal for mass code-14 read ETIMEDOUT in window', () => {
    const signal = detectConnectPartitionSignal(
      [
        {
          ts: NOW - 2_000,
          errMsg: 'read ETIMEDOUT',
          connectCode: '14',
          reasonSub: 'read-timeout',
          originalRequestId: 'rid-read-1',
        },
        {
          ts: NOW - 1_000,
          errMsg: 'read ETIMEDOUT',
          connectCode: '14',
          reasonSub: 'read-timeout',
          requestId: 'rid-read-2',
        },
      ],
      { nowMs: NOW, cursorConnectionCount: 30 },
    )
    assert.equal(signal?.pingFailureCount, 2)
  })

  it('returns undefined when cursor_conn below threshold', () => {
    const signal = detectConnectPartitionSignal(
      [{ ts: NOW, errMsg: 'PING timed out', connectCode: '14' }],
      { nowMs: NOW, cursorConnectionCount: CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS - 1 },
    )
    assert.equal(signal, undefined)
  })

  it('upgrades healthy probe attribution to transport_partition_stale', () => {
    const probe = {
      api2Ok: true,
      api2geoOk: true,
      marketplaceOk: true,
      api2LatencyMs: 298,
      api2geoLatencyMs: 298,
      marketplaceLatencyMs: 500,
    }
    const signal = detectConnectPartitionSignal(
      [
        { ts: NOW - 500, errMsg: 'PING timed out', connectCode: '14' },
        { ts: NOW - 200, errMsg: 'PING timed out', connectCode: '14' },
      ],
      { nowMs: NOW, cursorConnectionCount: 30 },
    )
    assert.equal(
      resolveProbeAttributionWithConnectPartition(probe, signal),
      'transport_partition_stale',
    )
    assert.equal(
      shouldTreatHealthyProbeAsConnectPartition(true, signal),
      true,
    )
  })

  it('uses 15s window at conn>=12 aligned with hung_scan (G11)', () => {
    assert.equal(resolveConnectPartitionWindowMs(30), HUNG_SCAN_INTERVAL_MS)
    assert.equal(resolveConnectPartitionWindowMs(CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS), HUNG_SCAN_INTERVAL_MS)
    assert.equal(resolveConnectPartitionWindowMs(CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS - 1), 8_000)
  })

  it('detects mass PING at T0+14s within 15s window (G11)', () => {
    const t0 = Date.parse('2026-07-27T10:59:00.000Z')
    const scanAt = t0 + 14_000
    const rows = [
      {
        ts: t0,
        errMsg: 'PING timed out',
        connectCode: '14',
        originalRequestId: 'rid-1',
      },
      {
        ts: t0 + 500,
        errMsg: 'PING timed out',
        connectCode: '14',
        requestId: 'rid-2',
      },
    ]
    const narrow = detectConnectPartitionSignal(rows, {
      nowMs: scanAt,
      cursorConnectionCount: 25,
      windowMs: 8_000,
    })
    assert.equal(narrow, undefined)

    const aligned = detectConnectPartitionSignal(rows, {
      nowMs: scanAt,
      cursorConnectionCount: 25,
      windowMs: resolveConnectPartitionWindowMs(25),
    })
    assert.equal(aligned?.pingFailureCount, 2)
  })

  it('uses 60s window at conn>=200 for sequential Diagnostic PING failures', () => {
    const incidentTs = Date.parse('2026-07-27T09:57:15.000Z')
    const rows = [
      {
        ts: incidentTs - 30_000,
        errMsg: '[unavailable] PING timed out',
        connectCode: '14',
        requestId: '83abc20e-d7e4-4208-a219-e55345f6e2cb',
      },
      {
        ts: incidentTs - 5_000,
        errMsg: '[unavailable] PING timed out',
        connectCode: '14',
        requestId: 'rid-agent-2',
      },
    ]
    const narrow = detectConnectPartitionSignal(rows, {
      nowMs: incidentTs,
      cursorConnectionCount: 816,
      windowMs: 8_000,
    })
    assert.equal(narrow, undefined)

    const wide = detectConnectPartitionSignal(rows, {
      nowMs: incidentTs,
      cursorConnectionCount: 816,
      windowMs: 60_000,
    })
    assert.equal(wide?.pingFailureCount, 2)
    assert.equal(wide?.windowMs, 60_000)
  })

  it('replays RID 5d03320f mass PING @ 2026-07-20 16:00 with green HTTP probes', () => {
    const incidentTs = Date.parse('2026-07-20T08:00:24.710Z')
    const rows = [
      {
        ts: incidentTs - 25,
        errMsg: 'PING timed out',
        connectCode: '14',
        originalRequestId: '5d03320f-c7bc-4772-8982-2a66c88db65c',
      },
      {
        ts: incidentTs - 18,
        errMsg: '[unavailable] PING timed out',
        connectCode: '14',
        requestId: '13592c36-0352-4e22-b697-81cf5647fc14',
      },
      {
        ts: incidentTs - 7,
        errMsg: 'ConnectError: [unavailable] PING timed out',
        connectCode: '14',
        requestId: '7a2c9f11-0000-4000-8000-000000000001',
      },
    ]
    const signal = detectConnectPartitionSignal(rows, {
      nowMs: incidentTs,
      cursorConnectionCount: 30,
    })
    assert.ok(signal)
    assert.equal(signal?.pingFailureCount, 3)
    assert.ok(signal?.sampleRequestIds.includes('5d03320f-c7bc-4772-8982-2a66c88db65c'))

    const greenProbe = {
      api2Ok: true,
      api2geoOk: true,
      marketplaceOk: true,
      api2LatencyMs: 298,
      api2geoLatencyMs: 298,
      marketplaceLatencyMs: 500,
    }
    assert.equal(
      resolveProbeAttributionWithConnectPartition(greenProbe, signal),
      'transport_partition_stale',
    )
  })
})
