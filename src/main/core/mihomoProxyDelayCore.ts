// [INPUT] none
// [OUTPUT] isMihomoApiResourceNotFoundError · resolveProviderNameForLeaf
// [POS] mihomo /proxies/{leaf}/delay Resource not found → 改走 provider 单点拨测端点。

export function isMihomoApiResourceNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return false
  }
  const { message } = error as { message?: unknown }
  return typeof message === 'string' && /resource not found/i.test(message)
}

export function resolveProviderNameForLeaf(
  providers: ControllerProxyProviders | null | undefined,
  proxy: string
): string | undefined {
  const normalized = proxy.trim()
  if (!normalized) {
    return undefined
  }
  for (const [providerName, detail] of Object.entries(providers?.providers ?? {})) {
    if (detail.proxies?.some((item) => item.name === normalized)) {
      return providerName
    }
  }
  return undefined
}
