export const DEFAULT_DELAY_TEST_CONCURRENCY = 3
export const MIN_DELAY_TEST_CONCURRENCY = 1
export const MAX_DELAY_TEST_CONCURRENCY = 512
export const VPS_DELAY_TEST_CONCURRENCY = 1

const VPS_NODE_SUFFIX = /-(HY2|Reality|TUIC|TLS)$/i

export function isVpsCursorLeafNode(name: string): boolean {
  return VPS_NODE_SUFFIX.test(name.trim())
}

export function isVpsCursorLeafBatch(proxyNames: readonly string[]): boolean {
  return proxyNames.length > 0 && proxyNames.every(isVpsCursorLeafNode)
}

export function normalizeDelayTestConcurrency(value?: number): number {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return DEFAULT_DELAY_TEST_CONCURRENCY

  return Math.min(
    Math.max(Math.floor(numericValue), MIN_DELAY_TEST_CONCURRENCY),
    MAX_DELAY_TEST_CONCURRENCY
  )
}

/** VPS QUIC/Reality leaves stampede api2 when batch-tested in parallel — serialize. */
export function resolveDelayTestConcurrencyForProxies(
  proxyNames: readonly string[],
  configuredConcurrency: number | undefined
): number {
  const normalized = normalizeDelayTestConcurrency(configuredConcurrency)
  if (proxyNames.length > 0 && proxyNames.every(isVpsCursorLeafNode)) {
    return VPS_DELAY_TEST_CONCURRENCY
  }
  return normalized
}

export async function runDelayTestsWithConcurrency<T>(
  items: T[],
  concurrency: number | undefined,
  run: (item: T) => Promise<void>
): Promise<void> {
  const workerCount = Math.min(normalizeDelayTestConcurrency(concurrency), items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async (_, workerIndex) => {
      for (let index = workerIndex; index < items.length; index += workerCount) {
        await run(items[index])
      }
    })
  )
}
