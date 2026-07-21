import { appendAppLog } from '../utils/log'
import { mihomoGroups, mihomoProxyDelay } from './mihomoApi'
import { resolveCursorStableSelectorGroup } from './cursorProxyGroup'
import { API2_PROBE_TARGET, API2GEO_PROBE_TARGET } from './cursorTransportHealthCore'
import {
  isMarathonQuIcInboundCursorNode,
  shouldRunHy2MarathonSessionKeepalive
} from './cursorHy2MarathonKeepaliveCore'

let lastHy2SessionKeepaliveAtMs = 0
let hy2SessionKeepaliveInFlight = false

export async function resolveCursorDedicatedActiveNode(): Promise<string | undefined> {
  const groups = await mihomoGroups()
  return resolveCursorStableSelectorGroup(groups)?.now
}

export async function runHy2MarathonSessionKeepaliveIfDue(
  cursorConnectionCount: number,
  options: { force?: boolean; nowMs?: number } = {}
): Promise<boolean> {
  if (hy2SessionKeepaliveInFlight) {
    return false
  }

  const nowMs = options.nowMs ?? Date.now()
  const activeNode = await resolveCursorDedicatedActiveNode()
  if (!activeNode || !isMarathonQuIcInboundCursorNode(activeNode)) {
    return false
  }

  if (
    !options.force &&
    !shouldRunHy2MarathonSessionKeepalive({
      activeNode,
      cursorConnectionCount,
      lastKeepaliveAtMs: lastHy2SessionKeepaliveAtMs,
      nowMs
    })
  ) {
    return false
  }

  hy2SessionKeepaliveInFlight = true
  try {
    const [api2Result, api2geoResult] = await Promise.all([
      mihomoProxyDelay(activeNode, API2_PROBE_TARGET),
      mihomoProxyDelay(activeNode, API2GEO_PROBE_TARGET),
    ])
    const api2DelayMs = typeof api2Result.delay === 'number' ? api2Result.delay : 0
    const api2geoDelayMs = typeof api2geoResult.delay === 'number' ? api2geoResult.delay : 0
    const delayMs = Math.max(api2DelayMs, api2geoDelayMs)
    if (delayMs <= 0) {
      await appendAppLog(
        `[CursorHy2MarathonKeepalive]: session_transport_nudge_weak node=${activeNode} cursor_conn=${cursorConnectionCount} api2_delay_ms=${api2DelayMs} api2geo_delay_ms=${api2geoDelayMs} msg=${api2Result.message ?? api2geoResult.message ?? 'none'}\n`
      )
      return false
    }
    lastHy2SessionKeepaliveAtMs = nowMs
    await appendAppLog(
      `[CursorHy2MarathonKeepalive]: session_transport_nudge node=${activeNode} cursor_conn=${cursorConnectionCount} api2_delay_ms=${api2DelayMs} api2geo_delay_ms=${api2geoDelayMs}\n`
    )
    return true
  } catch (error) {
    await appendAppLog(
      `[CursorHy2MarathonKeepalive]: session_transport_nudge_failed node=${activeNode} cursor_conn=${cursorConnectionCount} err=${error instanceof Error ? error.message : String(error)}\n`
    )
    return false
  } finally {
    hy2SessionKeepaliveInFlight = false
  }
}

export function resetHy2MarathonSessionKeepaliveStateForTests(): void {
  lastHy2SessionKeepaliveAtMs = 0
  hy2SessionKeepaliveInFlight = false
}
