// [INPUT] 无本地依赖
// [OUTPUT] collectProxyProviderIds · resolveExpectedProxyProviderIds · collectRunningProxyProviderIds · shouldRestartServiceCoreForProviderParity · formatProviderParityMismatchLog
// [POS] service 模式内核 provider 一致性的纯判定：磁盘 / 运行时配置的 `proxy-providers` 与内核实际运行的集合不一致时，判断是否需要重启内核。不含 IO。

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
  if (expected.length !== running.length) {
    return true
  }
  return expected.some((id, index) => id !== running[index])
}

export function formatProviderParityMismatchLog(
  expectedProviderIds: string[],
  runningProviderIds: string[]
): string {
  return `expected=[${[...expectedProviderIds].sort().join(',')}] running=[${[...runningProviderIds].sort().join(',')}]`
}
