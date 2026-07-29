import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatMihomoQuicSilentStallLogLine,
  isHy2QuIcConnectionFrozen,
  isHy2QuIcCursorTransportConnection,
  mihomoQuicSilentStallDedupeKey,
  scanMihomoQuicSilentStalls,
  shouldSkipMihomoQuicSilentStallEmit,
  type MihomoQuicStallTrackedConnection,
} from './mihomoQuicSilentStallCore'
import {
  MIHOMO_QUIC_STALL_AGGREGATE_FROZEN_MIN,
  MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS,
  MIHOMO_QUIC_STALL_MIN_CONN_AGE_MS,
} from './mihomoQuicSilentStallCore'

function hy2Conn(partial: Partial<ControllerConnectionDetail>): ControllerConnectionDetail {
  return {
    id: partial.id ?? 'conn-1',
    metadata: {
      network: 'tcp',
      host: 'api2direct.cursor.sh',
      ...(partial.metadata ?? {}),
    } as ControllerConnectionDetail['metadata'],
    upload: partial.upload ?? 100,
    download: partial.download ?? 200,
    uploadSpeed: partial.uploadSpeed ?? 0,
    downloadSpeed: partial.downloadSpeed ?? 0,
    start: partial.start ?? new Date(Date.now() - 120_000).toISOString(),
    chains: partial.chains ?? ['Cursor专用', 'JP-VPS-HY2'],
    rule: '',
    rulePayload: '',
    isActive: true,
  }
}

describe('mihomoQuicSilentStallCore', () => {
  it('detects HY2 critical-host transport connections', () => {
    assert.equal(isHy2QuIcCursorTransportConnection(hy2Conn({})), true)
    assert.equal(
      isHy2QuIcCursorTransportConnection(
        hy2Conn({ chains: ['Cursor专用', 'JP-VPS-Reality'], metadata: { network: 'tcp', host: 'api2.cursor.sh' } as ControllerConnectionDetail['metadata'] }),
      ),
      false,
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
    assert.equal(isHy2QuIcConnectionFrozen(hy2Conn({}), tracked, nowMs), true)
  })

  it('scan emits single + aggregate observations under ultra-conn', () => {
    const nowMs = 2_000_000
    const trackedById = new Map<string, MihomoQuicStallTrackedConnection>()
    const connections: ControllerConnectionDetail[] = []
    for (let index = 0; index < MIHOMO_QUIC_STALL_AGGREGATE_FROZEN_MIN; index += 1) {
      const id = `conn-${index}`
      connections.push(
        hy2Conn({
          id,
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
        leaf: 'JP-VPS-HY2',
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
      observations.find((row) => row.kind === 'aggregate')?.frozenHy2CursorCount,
      MIHOMO_QUIC_STALL_AGGREGATE_FROZEN_MIN,
    )
  })

  it('dedupe + log line include observe_only', () => {
    const observation = {
      kind: 'aggregate' as const,
      leaf: 'JP-VPS-HY2',
      stallMs: 50_000,
      frozenHy2CursorCount: 6,
      totalHy2CursorCount: 10,
      cursorConnectionCount: 90,
    }
    assert.equal(mihomoQuicSilentStallDedupeKey(observation), 'aggregate:JP-VPS-HY2')
    assert.equal(shouldSkipMihomoQuicSilentStallEmit(Date.now() - 1_000, Date.now(), observation), true)
    assert.match(formatMihomoQuicSilentStallLogLine(observation), /observe_only=true/)
  })
})
