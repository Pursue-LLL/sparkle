// [INPUT] 订阅节点记录（name / type / server / port|ports）
// [OUTPUT] computeProxyNodeFingerprint
// [POS] 节点指纹：按节点做的探测缓存（邮件端口 / agy 可用性）都以它为 key，
// 订阅刷新后服务器或端口一变即视为新节点，缓存自动失效并重新实测。

export type ProxyNodeRecord = Record<string, unknown>

export function computeProxyNodeFingerprint(proxy: ProxyNodeRecord): string {
  const name = String(proxy.name ?? '').trim()
  const type = String(proxy.type ?? '').trim().toLowerCase()
  const server = String(proxy.server ?? '').trim()
  const port = String(proxy.port ?? proxy.ports ?? '').trim()
  return `${name}|${type}|${server}|${port}`
}
