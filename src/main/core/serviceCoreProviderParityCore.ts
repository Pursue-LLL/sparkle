/** Detect when disk/runtime proxy-providers diverge from the live mihomo service core. */

const COMPATIBLE_VEHICLE_TYPE = 'Compatible' as const

export function collectProxyProviderIds(
  runtimeConfig: { 'proxy-providers'?: Record<string, unknown> } | null | undefined
): string[] {
  const providers = runtimeConfig?.['proxy-providers']
  if (!providers || typeof providers !== 'object') {
    return []
  }
  return Object.keys(providers).sort()
}

/** Resolve expected provider ids from in-memory runtime, falling back to disk work/config.yaml. */
export async function resolveExpectedProxyProviderIds(input: {
  runtimeConfig: { 'proxy-providers'?: Record<string, unknown> } | null | undefined
  loadDiskRuntimeConfig: () => Promise<{ 'proxy-providers'?: Record<string, unknown> } | null>
}): Promise<string[]> {
  const fromMemory = collectProxyProviderIds(input.runtimeConfig)
  if (fromMemory.length > 0) {
    return fromMemory
  }
  const disk = await input.loadDiskRuntimeConfig()
  return collectProxyProviderIds(disk)
}

export function collectRunningProxyProviderIds(
  providers: Record<string, { vehicleType?: string }> | null | undefined
): string[] {
  if (!providers) {
    return []
  }
  return Object.entries(providers)
    .filter(([, provider]) => provider.vehicleType !== COMPATIBLE_VEHICLE_TYPE)
    .map(([name]) => name)
    .sort()
}

export function shouldRestartServiceCoreForProviderParity(
  expectedProviderIds: string[],
  runningProviders: Record<string, { vehicleType?: string }> | null | undefined
): boolean {
  const expected = [...expectedProviderIds].sort()
  const running = collectRunningProxyProviderIds(runningProviders)
  if (expected.length === 0 && running.length === 0) {
    return false
  }
  if (expected.length !== running.length) {
    return true
  }
  return expected.some((id, index) => id !== running[index])
}

export function formatProviderParityMismatchLog(expectedProviderIds: string[], runningProviderIds: string[]): string {
  return `expected=[${[...expectedProviderIds].sort().join(',')}] running=[${[...runningProviderIds].sort().join(',')}]`
}

export function formatProviderHotReloadLog(expectedProviderIds: readonly string[], reason: string): string {
  return `tier0_hot_reload expected=[${[...expectedProviderIds].sort().join(',')}] reason=${reason}`
}
