/** High parallel Cursor load: widen VPS leaf dial-timeout without switching nodes. */

import { isHysteria2Proxy } from './hysteria2QuicStability'

export const MARATHON_DIAL_TOLERANCE_CONN_THRESHOLD = 12
export const MARATHON_DIAL_TIMEOUT_NORMAL_SEC = 5
export const MARATHON_DIAL_TIMEOUT_MARATHON_SEC = 45

const VPS_NODE_SUFFIX = /-(HY2|Reality|TUIC|TLS)$/i

export function isVpsCursorLeafNode(name: string): boolean {
  return VPS_NODE_SUFFIX.test(name.trim())
}

export function shouldEnableMarathonDialTolerance(cursorConnectionCount: number): boolean {
  return cursorConnectionCount >= MARATHON_DIAL_TOLERANCE_CONN_THRESHOLD
}

export function resolveMarathonDialTimeoutSec(cursorConnectionCount: number): number {
  return shouldEnableMarathonDialTolerance(cursorConnectionCount)
    ? MARATHON_DIAL_TIMEOUT_MARATHON_SEC
    : MARATHON_DIAL_TIMEOUT_NORMAL_SEC
}

function applyDialTimeoutToProxy(
  proxy: Record<string, unknown>,
  dialTimeoutSec: number,
): Record<string, unknown> {
  const next = { ...proxy }
  next['dial-timeout'] = dialTimeoutSec
  return next
}

/** Apply marathon dial-timeout to VPS HY2/Reality/TUIC/TLS leaf proxies only. */
export function applyMarathonDialToleranceToProxies(
  proxies: readonly unknown[],
  cursorConnectionCount: number,
): { proxies: unknown[]; changed: boolean; dialTimeoutSec: number } {
  const dialTimeoutSec = resolveMarathonDialTimeoutSec(cursorConnectionCount)
  let changed = false

  const mapped = proxies.map((proxy) => {
    if (typeof proxy !== 'object' || proxy === null) {
      return proxy
    }
    const record = proxy as Record<string, unknown>
    const name = String(record.name ?? '')
    if (!isVpsCursorLeafNode(name) && !isHysteria2Proxy(record)) {
      return proxy
    }
    const current = record['dial-timeout']
    if (current === dialTimeoutSec) {
      return proxy
    }
    changed = true
    return applyDialTimeoutToProxy(record, dialTimeoutSec)
  })

  return { proxies: mapped, changed, dialTimeoutSec }
}
