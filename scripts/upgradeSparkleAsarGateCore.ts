/** SSOT: post-build asar main bundle checks (upgrade-sparkle-local.sh + unit tests). */

export type SparkleMainAsarGateResult =
  | { ok: true }
  | { ok: false; reason: 'missing_main' | 'stale_bundle' | 'missing_mark_core_ready_call' }

/** Vite minifies to `.markCoreReadyAtMs(` on chunk export — bare `markCoreReadyAtMs(` is BUG-2026-07-23-004. */
export function validateSparkleMainAsarBundle(mainSource: string): SparkleMainAsarGateResult {
  if (!mainSource.includes('appendAppLog')) {
    return { ok: false, reason: 'stale_bundle' }
  }
  if (mainSource.includes('.markCoreReadyAtMs(')) {
    return { ok: true }
  }
  if (/\bmarkCoreReadyAtMs\s*\(/.test(mainSource)) {
    return { ok: false, reason: 'missing_mark_core_ready_call' }
  }
  return { ok: false, reason: 'missing_mark_core_ready_call' }
}

export function assertSparkleMainAsarBundle(mainSource: string): void {
  const result = validateSparkleMainAsarBundle(mainSource)
  if (!result.ok) {
    const messages: Record<Exclude<SparkleMainAsarGateResult, { ok: true }>['reason'], string> = {
      missing_main: 'asar missing out/main/index.js',
      stale_bundle: 'asar main bundle looks stale or corrupt',
      missing_mark_core_ready_call: 'asar missing markCoreReadyAtMs call — PostCoreBootstrap will fail',
    }
    throw new Error(messages[result.reason])
  }
}
