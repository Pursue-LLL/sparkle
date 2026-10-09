// [INPUT] none
// [OUTPUT] isMihomoApiResourceNotFoundError · resolveProviderNameForLeaf · isUserExplicitDelayPurpose
// [POS] mihomo /proxies/{leaf}/delay Resource not found → provider leaf refresh path.

export type MihomoDelayPurpose = 'default' | 'user_explicit'

export function isUserExplicitDelayPurpose(purpose: MihomoDelayPurpose | undefined): boolean {
  return purpose === 'user_explicit'
}

export function isMihomoApiResourceNotFoundError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && /resource not found/i.test(message)) {
      return true
    }
  }
  if (error instanceof Error && /resource not found/i.test(error.message)) {
    return true
  }
  return false
}

export function resolveProviderNameForLeaf(
  providers: ControllerProxyProviders | null | undefined,
  proxy: string,
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
