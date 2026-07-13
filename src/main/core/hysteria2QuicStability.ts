/** HY2 over macOS system TUN: conservative MTU reduces QUIC fragmentation loss. */
export const CURSOR_HY2_MTU = 1280

/** TUN UDP session timeout — align with CURSOR_KEEP_ALIVE_IDLE_SEC (3600s) for marathon Agent. */
export const CURSOR_TUN_UDP_TIMEOUT_SEC = 3600

/** macOS utun + QUIC: kernel GSO often causes silent UDP loss on HY2 paths. */
export const CURSOR_TUN_GSO_DARWIN = false

/** Slightly below 1500 to leave headroom for HY2/TUN encapsulation on Darwin. */
export const CURSOR_TUN_MTU_DARWIN = 1400

export function isHysteria2Proxy(proxy: unknown): proxy is Record<string, unknown> {
  if (typeof proxy !== 'object' || proxy === null) return false
  const type = (proxy as Record<string, unknown>).type
  return typeof type === 'string' && type.toLowerCase() === 'hysteria2'
}

/** Apply Cursor marathon-safe HY2 client params (sing-box HY2 prefers h3 ALPN). */
export function normalizeHysteria2Proxy(proxy: Record<string, unknown>): Record<string, unknown> {
  const next = { ...proxy }
  const mtu = next.mtu
  if (mtu === undefined || mtu === null || (typeof mtu === 'number' && mtu > CURSOR_HY2_MTU)) {
    next.mtu = CURSOR_HY2_MTU
  }
  if (next.alpn === undefined || next.alpn === null) {
    next.alpn = ['h3']
  }
  return next
}

export function applyHysteria2ProxiesQuicStability(proxies: unknown[]): unknown[] {
  return proxies.map((proxy) =>
    isHysteria2Proxy(proxy) ? normalizeHysteria2Proxy(proxy) : proxy,
  )
}
