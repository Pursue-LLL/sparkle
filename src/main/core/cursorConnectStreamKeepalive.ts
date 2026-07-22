// [INPUT] mihomoProxyDelay · cursorStreamTokenGapSignal · cursorConnectStreamKeepaliveCore
// [OUTPUT] runConnectStreamKeepaliveIfDue
// [POS] P8: api2direct + api2 dual probe on HY2/TUIC when Connect SSE goes quiet — non-destructive.

import { appendAppLog } from '../utils/log'
import { mihomoProxyDelay } from './mihomoApi'
import { resolveCursorDedicatedActiveNode } from './cursorHy2MarathonKeepalive'
import { isMarathonQuIcInboundCursorNode } from './cursorHy2MarathonKeepaliveCore'
import { API2_PROBE_TARGET } from './cursorTransportHealthCore'
import {
  API2DIRECT_PROBE_TARGET,
  shouldRunConnectStreamKeepalive,
} from './cursorConnectStreamKeepaliveCore'
import type { MarathonStreamTokenGapSignal } from './cursorStreamTokenGapCore'

let lastConnectStreamKeepaliveAtMs = 0
let connectStreamKeepaliveInFlight = false

export async function runConnectStreamKeepaliveIfDue(
  cursorConnectionCount: number,
  gapSignal: MarathonStreamTokenGapSignal | undefined,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!gapSignal || connectStreamKeepaliveInFlight) {
    return false
  }
  if (
    !shouldRunConnectStreamKeepalive(
      cursorConnectionCount,
      gapSignal.maxGapMs,
      lastConnectStreamKeepaliveAtMs,
      nowMs,
    )
  ) {
    return false
  }

  const activeNode = await resolveCursorDedicatedActiveNode()
  if (!activeNode || !isMarathonQuIcInboundCursorNode(activeNode)) {
    return false
  }

  connectStreamKeepaliveInFlight = true
  try {
    const [api2directResult, api2Result] = await Promise.all([
      mihomoProxyDelay(activeNode, API2DIRECT_PROBE_TARGET),
      mihomoProxyDelay(activeNode, API2_PROBE_TARGET),
    ])
    const api2directDelayMs =
      typeof api2directResult.delay === 'number' ? api2directResult.delay : 0
    const api2DelayMs = typeof api2Result.delay === 'number' ? api2Result.delay : 0
    if (api2directDelayMs <= 0 && api2DelayMs <= 0) {
      await appendAppLog(
        `[CursorConnectStreamKeepalive]: connect_stream_keepalive_weak node=${activeNode} cursor_conn=${cursorConnectionCount} max_gap_ms=${gapSignal.maxGapMs} api2direct_msg=${api2directResult.message ?? 'none'} api2_msg=${api2Result.message ?? 'none'}\n`,
      )
      return false
    }

    lastConnectStreamKeepaliveAtMs = nowMs
    const staleRids = gapSignal.staleRequestIds.slice(0, 3).join(',')
    await appendAppLog(
      `[CursorConnectStreamKeepalive]: connect_stream_keepalive node=${activeNode} cursor_conn=${cursorConnectionCount} max_gap_ms=${gapSignal.maxGapMs} api2direct_delay_ms=${api2directDelayMs} api2_delay_ms=${api2DelayMs} stale_rids=${staleRids}\n`,
    )
    return true
  } catch (error) {
    await appendAppLog(
      `[CursorConnectStreamKeepalive]: connect_stream_keepalive_failed node=${activeNode} cursor_conn=${cursorConnectionCount} err=${error instanceof Error ? error.message : String(error)}\n`,
    )
    return false
  } finally {
    connectStreamKeepaliveInFlight = false
  }
}
