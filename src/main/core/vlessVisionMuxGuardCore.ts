// [INPUT] 无本地依赖
// [OUTPUT] isVlessVisionProxy · normalizeVlessVisionProxy · applyVlessVisionMuxGuard · summarizeVlessVisionMuxGuard
// [POS] VLESS xtls-rprx-vision 与 sing-mux / Mux.Cool 互斥防护：识别 Vision 节点，移除其 `multiplex` 并显式写 `smux: false`（内核在 smux 缺省时可能隐式启用 sing-mux），避免 TLS BAD_DECRYPT。

/**
 * VLESS xtls-rprx-vision is incompatible with sing-box/clash multiplex (sing-mux / Mux.Cool).
 * @see https://github.com/SagerNet/sing-box/issues/1535 — TLS BAD_DECRYPT / bad record mac with both enabled.
 */

export function isVlessVisionProxy(proxy: unknown): proxy is Record<string, unknown> {
  if (typeof proxy !== 'object' || proxy === null) {
    return false
  }
  const record = proxy as Record<string, unknown>
  if (typeof record.type !== 'string' || record.type.toLowerCase() !== 'vless') {
    return false
  }
  const flow = record.flow
  return typeof flow === 'string' && flow.toLowerCase().includes('vision')
}

export interface VlessVisionMuxGuardResult {
  proxy: Record<string, unknown>
  strippedMultiplex: boolean
  ensuredSmuxOff: boolean
}

export function normalizeVlessVisionProxy(
  proxy: Record<string, unknown>
): VlessVisionMuxGuardResult {
  const next = { ...proxy }
  let strippedMultiplex = false

  if (next.multiplex !== undefined && next.multiplex !== null) {
    delete next.multiplex
    strippedMultiplex = true
  }

  // Unconditional: mihomo may implicit-enable sing-mux when smux is absent.
  next.smux = false

  return { proxy: next, strippedMultiplex, ensuredSmuxOff: true }
}

export function applyVlessVisionMuxGuard(proxies: unknown[]): unknown[] {
  return proxies.map((proxy) => {
    if (!isVlessVisionProxy(proxy)) {
      return proxy
    }
    return normalizeVlessVisionProxy(proxy).proxy
  })
}

export function summarizeVlessVisionMuxGuard(proxies: unknown[]): {
  visionNodeCount: number
  strippedMultiplexCount: number
  ensuredSmuxOffCount: number
  visionNodeNames: string[]
} {
  let visionNodeCount = 0
  let strippedMultiplexCount = 0
  let ensuredSmuxOffCount = 0
  const visionNodeNames: string[] = []

  for (const proxy of proxies) {
    if (!isVlessVisionProxy(proxy)) {
      continue
    }
    visionNodeCount += 1
    const name = typeof proxy.name === 'string' ? proxy.name : '(unnamed)'
    visionNodeNames.push(name)
    const result = normalizeVlessVisionProxy(proxy)
    if (result.strippedMultiplex) {
      strippedMultiplexCount += 1
    }
    if (result.ensuredSmuxOff) {
      ensuredSmuxOffCount += 1
    }
  }

  return { visionNodeCount, strippedMultiplexCount, ensuredSmuxOffCount, visionNodeNames }
}
