import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS,
  detectConnectPartitionSignal,
  isConnectPingTransportFailure,
  shouldTreatHealthyProbeAsConnectPartition,
} from './connectPartitionDetectCore'
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
