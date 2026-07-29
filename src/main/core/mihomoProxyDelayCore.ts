// [INPUT] none
// [OUTPUT] isMihomoApiResourceNotFoundError · resolveProviderNameForLeaf · isMarathonRescueDelayPurpose
// [POS] mihomo /proxies/{leaf}/delay Resource not found → provider leaf refresh path (marathon rescue SSOT).

export type MihomoDelayPurpose = 'default' | 'marathon_rescue' | 'user_explicit' | 'hy2_tunnel_vitality'

export function isMarathonRescueDelayPurpose(purpose: MihomoDelayPurpose | undefined): boolean {
  return purpose === 'marathon_rescue'
}

export function isHy2TunnelVitalityDelayPurpose(purpose: MihomoDelayPurpose | undefined): boolean {
  return purpose === 'hy2_tunnel_vitality'
}

export function isUserExplicitDelayPurpose(purpose: MihomoDelayPurpose | undefined): boolean {
  return purpose === 'user_explicit'
}

/** User explicit UI delay uses managed_ui_delay_test (allowed under marathon quiesce). */
export function shouldRefreshProviderLeafBeforeDelay(purpose: MihomoDelayPurpose | undefined): boolean {
  return isMarathonRescueDelayPurpose(purpose) || isUserExplicitDelayPurpose(purpose)
}

export function resolveProviderRefreshDialKind(
  purpose: MihomoDelayPurpose | undefined,
): 'managed_ui_delay_test' | 'provider_healthcheck_api' {
  return isUserExplicitDelayPurpose(purpose) ? 'managed_ui_delay_test' : 'provider_healthcheck_api'
}

/** Rescue + P27 vitality dial must not queue behind observability delay probes (BUG-015). */
export function shouldBypassMihomoDelayProbeSlot(purpose: MihomoDelayPurpose | undefined): boolean {
  return isMarathonRescueDelayPurpose(purpose) || isHy2TunnelVitalityDelayPurpose(purpose)
}

export function shouldBypassMarathonQuiesceForDelay(purpose: MihomoDelayPurpose | undefined): boolean {
  return isMarathonRescueDelayPurpose(purpose) || isHy2TunnelVitalityDelayPurpose(purpose)
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
