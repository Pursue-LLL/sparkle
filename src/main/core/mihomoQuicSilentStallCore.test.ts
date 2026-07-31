import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countMarathonFrozenQuicCursorConnections,
  formatMihomoQuicSilentStallLogLine,
  isMarathonQuIcConnectionFrozen,
  isMarathonQuIcCursorTransportConnection,
  mihomoQuicSilentStallDedupeKey,
  resolveMarathonQuIcLeafFromChains,
  scanMihomoQuicSilentStalls,
  shouldSkipMihomoQuicSilentStallEmit,
  type MihomoQuicStallTrackedConnection,
} from './mihomoQuicSilentStallCore'
import {
  MIHOMO_QUIC_STALL_AGGREGATE_FROZEN_MIN,
  MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS,
  MIHOMO_QUIC_STALL_MIN_CONN_AGE_MS,
} from './mihomoQuicSilentStallCore'

function quicConn(
  partial: Partial<ControllerConnectionDetail> & { leaf?: string },
): ControllerConnectionDetail {
  const leaf = partial.leaf ?? 'JP-VPS-HY2'
  return {
    id: partial.id ?? 'conn-1',
    metadata: {
      network: partial.metadata?.network ?? 'tcp',
      host: 'api2direct.cursor.sh',
      ...(partial.metadata ?? {}),
    } as ControllerConnectionDetail['metadata'],
    upload: partial.upload ?? 100,
    download: partial.download ?? 200,
    uploadSpeed: partial.uploadSpeed ?? 0,
    downloadSpeed: partial.downloadSpeed ?? 0,
    start: partial.start ?? new Date(Date.now() - 120_000).toISOString(),
    chains: partial.chains ?? ['Cursor专用', leaf],
    rule: '',
    rulePayload: '',
    isActive: true,
  }
}

describe('mihomoQuicSilentStallCore R-17', () => {
  it('resolveMarathonQuIcLeafFromChains matches HY2 and TUIC', () => {
    assert.equal(resolveMarathonQuIcLeafFromChains(['Cursor专用', 'JP-VPS-HY2']), 'JP-VPS-HY2')
    assert.equal(resolveMarathonQuIcLeafFromChains(['Cursor专用', 'JP-VPS-TUIC']), 'JP-VPS-TUIC')
    assert.equal(resolveMarathonQuIcLeafFromChains(['Cursor专用', 'JP-VPS-TLS']), undefined)
  })

  it('detects HY2 critical-host transport connections', () => {
    assert.equal(isMarathonQuIcCursorTransportConnection(quicConn({ leaf: 'JP-VPS-HY2' })), true)
    assert.equal(
      isMarathonQuIcCursorTransportConnection(
        quicConn({
          leaf: 'JP-VPS-Reality',
          chains: ['Cursor专用', 'JP-VPS-Reality'],
          metadata: { network: 'tcp', host: 'api2.cursor.sh' } as ControllerConnectionDetail['metadata'],
        }),
      ),
      false,
    )
  })

  it('detects TUIC critical-host transport connections', () => {
    assert.equal(isMarathonQuIcCursorTransportConnection(quicConn({ leaf: 'JP-VPS-TUIC' })), true)
    assert.equal(
      isMarathonQuIcCursorTransportConnection(
        quicConn({
          leaf: 'JP-VPS-TUIC',
          chains: ['Cursor专用', 'JP-VPS-TUIC'],
          metadata: { network: 'udp', host: 'api2direct.cursor.sh' } as ControllerConnectionDetail['metadata'],
        }),
      ),
      true,
    )
  })

  it('flags frozen aged HY2 flow', () => {
    const nowMs = 1_000_000
    const tracked: MihomoQuicStallTrackedConnection = {
      upload: 100,
      download: 200,
      lastBytesChangeAtMs: nowMs - MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS - 1,
      firstSeenAtMs: nowMs - MIHOMO_QUIC_STALL_MIN_CONN_AGE_MS - 1,
      host: 'api2direct.cursor.sh',
      leaf: 'JP-VPS-HY2',
      network: 'tcp',
    }
    assert.equal(isMarathonQuIcConnectionFrozen(quicConn({ leaf: 'JP-VPS-HY2' }), tracked, nowMs), true)
  })

  it('flags frozen aged TUIC flow', () => {
    const nowMs = 2_000_000
    const tracked: MihomoQuicStallTrackedConnection = {
      upload: 80,
      download: 90,
      lastBytesChangeAtMs: nowMs - 60_000,
      firstSeenAtMs: nowMs - 120_000,
      host: 'api2direct.cursor.sh',
      leaf: 'JP-VPS-TUIC',
      network: 'tcp',
    }
    assert.equal(
      isMarathonQuIcConnectionFrozen(quicConn({ leaf: 'JP-VPS-TUIC' }), tracked, nowMs),
      true,
    )
  })

  it('scan emits TUIC single observation under marathon load', () => {
    const nowMs = 3_000_000
    const id = 'tuic-conn-1'
    const trackedById = new Map<string, MihomoQuicStallTrackedConnection>([
      [
        id,
        {
          upload: 50,
          download: 50,
          lastBytesChangeAtMs: nowMs - 60_000,
          firstSeenAtMs: nowMs - 120_000,
          host: 'api2direct.cursor.sh',
          leaf: 'JP-VPS-TUIC',
          network: 'tcp',
        },
      ],
    ])
    const observations = scanMihomoQuicSilentStalls({
      connections: [
        quicConn({
          id,
          leaf: 'JP-VPS-TUIC',
          metadata: {
            network: 'tcp',
            host: 'api2direct.cursor.sh',
            processPath: '/Applications/Cursor.app/Contents/MacOS/Cursor',
          } as ControllerConnectionDetail['metadata'],
        }),
      ],
      trackedById,
      nowMs,
      cursorConnectionCount: 20,
    })
    assert.equal(observations.length, 1)
    assert.equal(observations[0]?.leaf, 'JP-VPS-TUIC')
    assert.equal(observations[0]?.kind, 'single')
  })

  it('scan emits single + aggregate observations under ultra-conn', () => {
    const nowMs = 4_000_000
    const trackedById = new Map<string, MihomoQuicStallTrackedConnection>()
    const connections: ControllerConnectionDetail[] = []
    for (let index = 0; index < MIHOMO_QUIC_STALL_AGGREGATE_FROZEN_MIN; index += 1) {
      const id = `conn-${index}`
      const leaf = index % 2 === 0 ? 'JP-VPS-HY2' : 'JP-VPS-TUIC'
      connections.push(
        quicConn({
          id,
          leaf,
          metadata: {
            network: 'tcp',
            host: 'api2direct.cursor.sh',
            processPath: '/Applications/Cursor.app/Contents/MacOS/Cursor',
          } as ControllerConnectionDetail['metadata'],
        }),
      )
      trackedById.set(id, {
        upload: 50,
        download: 50,
        lastBytesChangeAtMs: nowMs - 60_000,
        firstSeenAtMs: nowMs - 120_000,
        host: 'api2direct.cursor.sh',
        leaf,
        network: 'tcp',
      })
    }

    const observations = scanMihomoQuicSilentStalls({
      connections,
      trackedById,
      nowMs,
      cursorConnectionCount: 85,
    })
    assert.ok(observations.some((row) => row.kind === 'single'))
    assert.ok(observations.some((row) => row.kind === 'aggregate'))
    assert.equal(
      observations.find((row) => row.kind === 'aggregate')?.frozenQuicCursorCount,
      MIHOMO_QUIC_STALL_AGGREGATE_FROZEN_MIN,
    )
  })

  it('countMarathonFrozenQuicCursorConnections counts byte-frozen QUIC cursor transports', () => {
    const nowMs = 1_000_000
    const trackedById = new Map<string, MihomoQuicStallTrackedConnection>()
    const connection = quicConn({ id: 'c1', leaf: 'JP-VPS-TUIC' })
    trackedById.set(connection.id, {
      host: 'api2.cursor.sh',
      network: 'udp',
      upload: 100,
      download: 200,
      firstSeenAtMs: nowMs - 120_000,
      lastBytesChangeAtMs: nowMs - MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS - 1,
    })
    assert.equal(
      countMarathonFrozenQuicCursorConnections({
        connections: [connection],
        trackedById,
        nowMs,
      }),
      1,
    )
  })

  it('dedupe + log line include observe_only and frozen_quic_cursor', () => {
    const observation = {
      kind: 'aggregate' as const,
      leaf: 'JP-VPS-TUIC',
      stallMs: 50_000,
      frozenQuicCursorCount: 6,
      totalQuicCursorCount: 10,
      cursorConnectionCount: 90,
    }
    assert.equal(mihomoQuicSilentStallDedupeKey(observation), 'aggregate:JP-VPS-TUIC')
    assert.equal(shouldSkipMihomoQuicSilentStallEmit(Date.now() - 1_000, Date.now(), observation), true)
    assert.match(formatMihomoQuicSilentStallLogLine(observation), /recovery=R-33/)
    assert.match(formatMihomoQuicSilentStallLogLine(observation), /frozen_quic_cursor=6/)
  })
})
