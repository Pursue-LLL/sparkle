// [INPUT] 无本地依赖
// [OUTPUT] ANYTLS_DISABLE_REUSE_KEY · isAnytlsProxy · normalizeAnytlsProxy · applyAnytlsReuseGuard · summarizeAnytlsReuseGuard
// [POS] AnyTLS 会话复用防护：识别 AnyTLS 节点，对没有显式设置 `disable-reuse` 的节点写 `disable-reuse: true`，让每条连接独占一个新会话。

/**
 * mihomo 的 AnyTLS 客户端（协议 v2）在会话上开第 2 条及以后的流（流号 ≥ 2、对端协议版本 ≥ 2）时，
 * 会起一个 3 秒的看门狗：3 秒内没收到服务端的 SYNACK，就关闭整个会话及其 TCP。
 * 服务端只转发数据、不回 SYNACK 时，复用会话上存活超过 3 秒的流都会在第 3 秒被掐断；
 * 新会话的第 1 条流不起看门狗，不受影响。`disable-reuse` 让每条流都是新会话的第 1 条流。
 * @see mihomo transport/anytls/session/session.go（OpenStream）· adapter/outbound/anytls.go（DisableReuse）
 */
export const ANYTLS_DISABLE_REUSE_KEY = 'disable-reuse'

/** mihomo 只认小写 `anytls`（`AnyTLS`、带空格的写法实测报 `unsupport proxy type`），精确比较即可。 */
export function isAnytlsProxy(proxy: unknown): proxy is Record<string, unknown> {
  if (typeof proxy !== 'object' || proxy === null) {
    return false
  }
  return (proxy as Record<string, unknown>).type === 'anytls'
}

/**
 * 只补缺省：订阅作者显式写过的值（含 `false`）是明确意图，原样保留；
 * 键写了却没写值（YAML 解析为 null）等同没写。无需改动时返回入参本身，不拷贝。
 */
export function normalizeAnytlsProxy(proxy: Record<string, unknown>): Record<string, unknown> {
  const current = proxy[ANYTLS_DISABLE_REUSE_KEY]
  if (current !== undefined && current !== null) {
    return proxy
  }
  return { ...proxy, [ANYTLS_DISABLE_REUSE_KEY]: true }
}

export function applyAnytlsReuseGuard(proxies: unknown[]): unknown[] {
  return proxies.map((proxy) => (isAnytlsProxy(proxy) ? normalizeAnytlsProxy(proxy) : proxy))
}

/** 防护生效后的状态：AnyTLS 节点总数、其中关闭了会话复用的个数与节点名（二者之差即订阅显式保留复用的节点）。 */
export function summarizeAnytlsReuseGuard(proxies: unknown[]): {
  nodeCount: number
  reuseDisabledCount: number
  nodeNames: string[]
} {
  const nodeNames: string[] = []
  let reuseDisabledCount = 0

  for (const proxy of proxies) {
    if (!isAnytlsProxy(proxy)) {
      continue
    }
    nodeNames.push(typeof proxy.name === 'string' ? proxy.name : '(unnamed)')
    if (normalizeAnytlsProxy(proxy)[ANYTLS_DISABLE_REUSE_KEY] === true) {
      reuseDisabledCount += 1
    }
  }

  return { nodeCount: nodeNames.length, reuseDisabledCount, nodeNames }
}
