import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bindMarathonCarrierConnections,
  isLikelyShortVitalityProbe,
  pickCarrierConnectionForRid,
  resolveStallRecoveryCloseTarget,
} from './marathonCarrierConnectionBindCore'
import {
  createMihomoQuicStallTrackedConnection,
  MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS,
  MIHOMO_QUIC_STALL_MIN_CONN_AGE_MS,
} from './mihomoQuicSilentStallCore'

const RID_9480 = '9480ace0-4dfd-4bf5-99e0-0f9ee5639d67'
const OBS_CONN = 'c8ed1237-1111-2222-3333-444444444444'
const CARRIER_CONN = 'carrier-9480-sse-conn'

function conn(
  partial: Partial<ControllerConnectionDetail> & { id: string; upload: number; download: number; host: string },
): ControllerConnectionDetail {
  return {
    id: partial.id,
    upload: partial.upload,
    download: partial.download,
    uploadSpeed: 0,
    downloadSpeed: 0,
    chains: ['KR-VPS-HY2'],
    metadata: {
      network: 'tcp',
      host: partial.host,
      processPath: '/Applications/Cursor.app/Contents/MacOS/Cursor',
      process: 'Cursor',
    },
  } as ControllerConnectionDetail
}

function frozenTracked(input: {
  upload: number
  download: number
  firstSeenAtMs: number
  lastBytesChangeAtMs: number
  host: string
}) {
  return createMihomoQuicStallTrackedConnection(
    conn({
      id: 'tracked-seed',
      upload: input.upload,
      download: input.download,
      host: input.host,
    }),
    'KR-VPS-HY2',
    input.lastBytesChangeAtMs,
  )
}

describe('marathonCarrierConnectionBindCore R-38', () => {
  it('9480ace0 FULL_REPLAY: close carrier conn not short api2 probe', () => {
    const nowMs = 1_800_000_000_000
    const stallMs = 209_496
    const connections = [
      conn({
        id: OBS_CONN,
        upload: 2426,
        download: 4950,
        host: 'api2.cursor.sh',
      }),
      conn({
        id: CARRIER_CONN,
        upload: 52_722,
        download: 19_219,
        host: 'api2direct.cursor.sh',
      }),
    ]
    const trackedById = new Map([
      [
        OBS_CONN,
        {
          ...frozenTracked({
            upload: 2426,
            download: 4950,
            host: 'api2.cursor.sh',
            firstSeenAtMs: nowMs - 214_268,
            lastBytesChangeAtMs: nowMs - stallMs,
          }),
          firstSeenAtMs: nowMs - 214_268,
          lastBytesChangeAtMs: nowMs - stallMs,
        },
      ],
      [
        CARRIER_CONN,
        {
          ...frozenTracked({
            upload: 52_722,
            download: 19_219,
            host: 'api2direct.cursor.sh',
            firstSeenAtMs: nowMs - 284_946,
            lastBytesChangeAtMs: nowMs - stallMs,
          }),
          firstSeenAtMs: nowMs - 284_946,
          lastBytesChangeAtMs: nowMs - stallMs,
        },
      ],
    ])

    assert.equal(
      isLikelyShortVitalityProbe({
        connection: connections[0]!,
        tracked: trackedById.get(OBS_CONN)!,
        nowMs,
      }),
      true,
    )

    const picked = pickCarrierConnectionForRid({
      carrierRid: RID_9480,
      connections,
      trackedById,
      nowMs,
    })
    assert.equal(picked?.connectionId, CARRIER_CONN)

    const closeTarget = resolveStallRecoveryCloseTarget({
      observation: {
        kind: 'single',
        connectionId: OBS_CONN,
        host: 'api2.cursor.sh',
        leaf: 'KR-VPS-HY2',
        network: 'tcp',
        stallMs,
        upload: 2426,
        download: 4950,
        frozenQuicCursorCount: 2,
        totalQuicCursorCount: 10,
        cursorConnectionCount: 25,
      },
      carrierRid: RID_9480,
      registry: { records: new Map() },
      connections,
      trackedById,
      nowMs,
    })
    assert.equal(closeTarget.connectionId, CARRIER_CONN)
    assert.equal(closeTarget.closeTargetSource, 'carrier_rid_mapped')
    assert.notEqual(closeTarget.connectionId, OBS_CONN)
  })

  it('bindMarathonCarrierConnections writes carrierConnectionId on stale RID records', () => {
    const nowMs = 2_000_000
    const connections = [
      conn({
        id: CARRIER_CONN,
        upload: 40_000,
        download: 20_000,
        host: 'api2direct.cursor.sh',
      }),
    ]
    const trackedById = new Map([
      [
        CARRIER_CONN,
        {
          ...createMihomoQuicStallTrackedConnection(connections[0]!, 'KR-VPS-HY2', nowMs),
          firstSeenAtMs: nowMs - MIHOMO_QUIC_STALL_MIN_CONN_AGE_MS - 10_000,
          lastBytesChangeAtMs: nowMs - MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS - 1_000,
        },
      ],
    ])
    const bound = bindMarathonCarrierConnections({
      registry: {
        records: new Map([
          [
            'req-1',
            {
              requestId: 'req-1',
              originalRequestId: RID_9480,
              firstActivityMs: nowMs - 600_000,
              lastActivityMs: nowMs - 130_000,
              openToolCalls: 0,
            },
          ],
        ]),
      },
      connections,
      trackedById,
      staleRequestIds: [RID_9480],
      nowMs,
    })
    const record = bound.records.get('req-1')
    assert.equal(record?.carrierConnectionId, CARRIER_CONN)
    assert.equal(record?.carrierHost, 'api2direct.cursor.sh')
  })

  it('rejects closing short probe when carrier_rid set but no mapped carrier', () => {
    const nowMs = 3_000_000
    const connections = [
      conn({
        id: OBS_CONN,
        upload: 2400,
        download: 4900,
        host: 'api2.cursor.sh',
      }),
    ]
    const trackedById = new Map([
      [
        OBS_CONN,
        {
          ...createMihomoQuicStallTrackedConnection(connections[0]!, 'KR-VPS-HY2', nowMs),
          firstSeenAtMs: nowMs - 120_000,
          lastBytesChangeAtMs: nowMs - 60_000,
        },
      ],
    ])
    const closeTarget = resolveStallRecoveryCloseTarget({
      observation: {
        kind: 'single',
        connectionId: OBS_CONN,
        host: 'api2.cursor.sh',
        leaf: 'KR-VPS-HY2',
        stallMs: 60_000,
        frozenQuicCursorCount: 1,
        totalQuicCursorCount: 5,
        cursorConnectionCount: 20,
      },
      carrierRid: RID_9480,
      registry: { records: new Map() },
      connections,
      trackedById,
      nowMs,
    })
    assert.equal(closeTarget.connectionId, '')
  })

  it('denies unbound critical host close on api2 marathon SSE without carrier bind', () => {
    const nowMs = 4_000_000
    const stallMs = 209_496
    const connections = [
      conn({
        id: OBS_CONN,
        upload: 52_722,
        download: 19_219,
        host: 'api2.cursor.sh',
      }),
    ]
    const trackedById = new Map([
      [
        OBS_CONN,
        {
          ...frozenTracked({
            upload: 52_722,
            download: 19_219,
            host: 'api2.cursor.sh',
            firstSeenAtMs: nowMs - 284_946,
            lastBytesChangeAtMs: nowMs - stallMs,
          }),
          firstSeenAtMs: nowMs - 284_946,
          lastBytesChangeAtMs: nowMs - stallMs,
        },
      ],
    ])
    const closeTarget = resolveStallRecoveryCloseTarget({
      observation: {
        kind: 'single',
        connectionId: OBS_CONN,
        host: 'api2.cursor.sh',
        leaf: 'KR-VPS-HY2',
        network: 'tcp',
        stallMs,
        upload: 52_722,
        download: 19_219,
        frozenQuicCursorCount: 2,
        totalQuicCursorCount: 10,
        cursorConnectionCount: 25,
      },
      carrierRid: undefined,
      registry: { records: new Map() },
      connections,
      trackedById,
      nowMs,
    })
    assert.equal(closeTarget.connectionId, '')
    assert.equal(closeTarget.closeTargetSource, 'deny_unbound_critical_host')
  })
})
