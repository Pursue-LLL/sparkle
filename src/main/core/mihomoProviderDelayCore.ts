/** Reuse provider history when younger than mihomo's 300s health-check interval. */
export const PROVIDER_DELAY_CACHE_TTL_MS = 120_000

export function pickLatestSuccessfulProviderDelay(
  history: ControllerProxiesHistory[]
): ControllerProxiesHistory | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (entry && entry.delay > 0) {
      return entry
    }
  }
  return undefined
}

export function pickFreshSuccessfulProviderDelay(
  history: ControllerProxiesHistory[],
  nowMs: number = Date.now(),
  maxAgeMs: number = PROVIDER_DELAY_CACHE_TTL_MS
): ControllerProxiesHistory | undefined {
  const latest = pickLatestSuccessfulProviderDelay(history)
  if (!latest) {
    return undefined
  }
  const sampledMs = Date.parse(latest.time)
  if (!Number.isFinite(sampledMs)) {
    return undefined
  }
  if (nowMs - sampledMs > maxAgeMs) {
    return undefined
  }
  return latest
}
